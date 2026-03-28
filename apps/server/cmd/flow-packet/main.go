package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/flow-packet/server/internal/api"
	"github.com/flow-packet/server/internal/codec"
	"github.com/flow-packet/server/internal/engine"
	"github.com/flow-packet/server/internal/network"
)

type frameFieldRequest struct {
	Name    string `json:"name"`
	Bytes   int    `json:"bytes"`
	IsRoute bool   `json:"isRoute"`
	IsSeq   bool   `json:"isSeq"`
}

type connConnectRequest struct {
	ConnectionID string              `json:"connectionId"`
	Host         string              `json:"host"`
	Port         int                 `json:"port"`
	Protocol     string              `json:"protocol"`
	Timeout      int                 `json:"timeout"`
	Reconnect    bool                `json:"reconnect"`
	Heartbeat    bool                `json:"heartbeat"`
	ByteOrder    string              `json:"byteOrder"`
	ParserMode   string              `json:"parserMode"`
	FrameFields  []frameFieldRequest `json:"frameFields"`
}

type packetLogPayload struct {
	ConnectionID string         `json:"connectionId"`
	DeviceID     string         `json:"deviceId,omitempty"`
	Source       string         `json:"source"`
	Route        uint32         `json:"route,omitempty"`
	StringRoute  string         `json:"stringRoute,omitempty"`
	Seq          uint32         `json:"seq,omitempty"`
	MessageName  string         `json:"messageName,omitempty"`
	Data         map[string]any `json:"data,omitempty"`
}

func main() {
	workDir, err := os.UserConfigDir()
	if err != nil {
		workDir = os.TempDir()
	}
	dataDir := filepath.Join(workDir, "flow-packet")

	packetCfg := codec.PacketConfig{
		RouteBytes: 2,
		SeqBytes:   2,
	}

	tcpClient := network.NewTCPClient(packetCfg)
	wsClient := network.NewWSClient(packetCfg)
	var activeClient network.Client = tcpClient
	var activeConnectionID string

	runner := engine.NewRunner(packetCfg)
	runner.SetSendFunc(func(data []byte) error {
		return activeClient.Send(data)
	})

	srv := api.NewServer()
	appState := api.NewAppState(dataDir)
	api.RegisterHandlers(srv, appState)

	hb := network.NewHeartbeat(network.DefaultHeartbeatConfig(), packetCfg)
	hb.OnSend(func(data []byte) error {
		return activeClient.Send(data)
	})
	hb.OnTimeout(func() {
		_ = activeClient.Disconnect()
	})

	pomeloHandshakeCh := make(chan []byte, 1)
	sessionManager := newFlowSessionManager(
		func(payload sessionStatusPayload) {
			srv.Broadcast(api.ServerMessage{
				Event:   "session.status",
				Payload: payload,
			})
		},
		func(payload packetLogPayload) {
			srv.Broadcast(api.ServerMessage{
				Event:   "packet.received",
				Payload: payload,
			})
		},
	)

	registerConnHandlers(srv, appState, tcpClient, wsClient, &activeClient, &activeConnectionID, &packetCfg, runner, hb, pomeloHandshakeCh, sessionManager)
	registerFlowHandlers(srv, runner, appState, sessionManager)

	onReceive := func(_ network.Conn, data []byte) {
		pkt, err := codec.DecodeBytes(data, packetCfg)
		if err != nil {
			return
		}
		if pkt.IsHeartbeat() {
			hb.Feed()
			return
		}
		if packetCfg.IsPomelo() && pkt.ExtCode != 0 {
			switch pkt.ExtCode {
			case codec.PomeloPacketHandshake:
				select {
				case pomeloHandshakeCh <- pkt.Data:
				default:
				}
			case codec.PomeloPacketKick:
				_ = activeClient.Disconnect()
			}
			return
		}
		emitPacketLogAsync(func(payload packetLogPayload) {
			srv.Broadcast(api.ServerMessage{
				Event:   "packet.received",
				Payload: payload,
			})
		}, runner, pkt, activeConnectionID, "", "connection")
		runner.HandleIncomingPacket(pkt)
	}

	onConnect := func(conn network.Conn) {
		hb.Start()
		srv.Broadcast(api.ServerMessage{
			Event:   "conn.status",
			Payload: map[string]any{"state": "connected", "addr": conn.RemoteAddr().String()},
		})
	}
	onDisconnect := func(_ network.Conn, _ error) {
		hb.Stop()
		srv.Broadcast(api.ServerMessage{
			Event:   "conn.status",
			Payload: map[string]any{"state": "disconnected"},
		})
	}

	tcpClient.OnReceive(onReceive)
	tcpClient.OnConnect(onConnect)
	tcpClient.OnDisconnect(onDisconnect)
	wsClient.OnReceive(onReceive)
	wsClient.OnConnect(onConnect)
	wsClient.OnDisconnect(onDisconnect)

	actualPort, err := srv.Start(58996)
	if err != nil {
		actualPort, err = srv.Start(0)
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to start server: %v\n", err)
			os.Exit(1)
		}
	}
	fmt.Printf("PORT:%d\n", actualPort)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	_ = tcpClient.Disconnect()
	_ = wsClient.Disconnect()
	sessionManager.CloseAll()
	_ = srv.Stop()
}

func registerConnHandlers(srv *api.Server, state *api.AppState, tcpClient *network.TCPClient, wsClient *network.WSClient, activeClient *network.Client, activeConnectionID *string, packetCfg *codec.PacketConfig, runner *engine.Runner, hb *network.Heartbeat, pomeloHandshakeCh chan []byte, sessionManager *flowSessionManager) {
	applyConfig := func(newCfg codec.PacketConfig, thriftProtocol string) {
		*packetCfg = newCfg
		tcpClient.SetPacketConfig(newCfg)
		wsClient.SetPacketConfig(newCfg)
		runner.SetPacketConfig(newCfg)
		runner.SetThriftProtocol(thriftProtocol)
	}

	srv.Handle("conn.connect", func(payload json.RawMessage) (any, error) {
		var req connConnectRequest
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid payload: %w", err)
		}

		hb.Stop()
		_ = (*activeClient).Disconnect()
		clearHandshakeChannel(pomeloHandshakeCh)

		newCfg, thriftProtocol, err := buildPacketConfig(req)
		if err != nil {
			return nil, err
		}
		applyConfig(newCfg, thriftProtocol)

		addr := fmt.Sprintf("%s:%d", req.Host, req.Port)
		connectTimeout := 5 * time.Second
		if req.Timeout > 0 {
			connectTimeout = time.Duration(req.Timeout) * time.Millisecond
		}

		reconnectCfg := network.ReconnectConfig{
			Enable:      req.Reconnect,
			MaxRetries:  10,
			InitialWait: 1 * time.Second,
			MaxWait:     30 * time.Second,
			Multiplier:  2.0,
		}

		if req.Heartbeat || packetCfg.IsPomelo() {
			hb.SetEnable(true)
			hb.SetPacketConfig(*packetCfg)
		} else {
			hb.SetEnable(false)
		}

		if req.Protocol == "ws" {
			*activeClient = wsClient
			wsClient.SetReconnectConfig(reconnectCfg)
			wsClient.SetConnectTimeout(connectTimeout)
		} else {
			*activeClient = tcpClient
			tcpClient.SetReconnectConfig(reconnectCfg)
			tcpClient.SetConnectTimeout(connectTimeout)
		}

		if err := (*activeClient).Connect(addr); err != nil {
			return nil, fmt.Errorf("connect failed: %w", err)
		}

		if packetCfg.IsPomelo() {
			if err := performPomeloHandshake(*activeClient, pomeloHandshakeCh); err != nil {
				_ = (*activeClient).Disconnect()
				return nil, err
			}
		}

		if req.ConnectionID != "" {
			*activeConnectionID = req.ConnectionID
			if cs := state.GetConnState(req.ConnectionID); cs != nil && (cs.ParseResult != nil || cs.ThriftResult != nil) {
				_ = configureRunnerForConnState(runner, cs)
			}
			sessionManager.SetConnectionConfig(connectionRuntimeConfig{
				ConnectionID:   req.ConnectionID,
				Host:           req.Host,
				Port:           req.Port,
				Protocol:       req.Protocol,
				ConnectTimeout: connectTimeout,
				PacketConfig:   *packetCfg,
				Heartbeat:      req.Heartbeat || packetCfg.IsPomelo(),
				ThriftProtocol: thriftProtocol,
			})
		}

		return map[string]string{"status": "connected"}, nil
	})

	srv.Handle("conn.disconnect", func(payload json.RawMessage) (any, error) {
		var req struct {
			ConnectionID string `json:"connectionId"`
		}
		_ = json.Unmarshal(payload, &req)

		if err := (*activeClient).Disconnect(); err != nil {
			return nil, fmt.Errorf("disconnect failed: %w", err)
		}
		if req.ConnectionID == "" || *activeConnectionID == req.ConnectionID {
			*activeConnectionID = ""
		}
		if req.ConnectionID != "" {
			sessionManager.RemoveConnection(req.ConnectionID)
		}
		return map[string]string{"status": "disconnected"}, nil
	})

	srv.Handle("conn.status", func(payload json.RawMessage) (any, error) {
		return map[string]string{"state": (*activeClient).State().String()}, nil
	})
}

func registerFlowHandlers(srv *api.Server, legacyRunner *engine.Runner, state *api.AppState, sessionManager *flowSessionManager) {
	srv.Handle("session.login", func(payload json.RawMessage) (any, error) {
		var req struct {
			ConnectionID string `json:"connectionId"`
			DeviceID     string `json:"deviceId"`
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid payload: %w", err)
		}
		req.DeviceID = strings.TrimSpace(req.DeviceID)
		if req.ConnectionID == "" || req.DeviceID == "" {
			return nil, fmt.Errorf("connectionId and deviceId are required")
		}

		cs := state.GetConnState(req.ConnectionID)
		if cs == nil {
			return nil, fmt.Errorf("connection state not found")
		}

		session, err := sessionManager.EnsureSession(req.ConnectionID, req.DeviceID, cs)
		if err != nil {
			return nil, err
		}
		if err := session.ensureLoggedIn(); err != nil {
			return nil, err
		}
		return map[string]string{"status": "ready"}, nil
	})

	srv.Handle("flow.execute", func(payload json.RawMessage) (any, error) {
		var req struct {
			ConnectionID string            `json:"connectionId"`
			DeviceID     string            `json:"deviceId"`
			Nodes        []engine.FlowNode `json:"nodes"`
			Edges        []engine.FlowEdge `json:"edges"`
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid payload: %w", err)
		}

		cs := state.GetConnState(req.ConnectionID)
		if cs == nil {
			return nil, fmt.Errorf("connection state not found")
		}

		runnerToUse := legacyRunner
		if req.DeviceID != "" {
			session := sessionManager.GetSession(req.ConnectionID, req.DeviceID)
			if session == nil {
				return nil, fmt.Errorf("business session for deviceId %s is not logged in", req.DeviceID)
			}
			if !session.isReady() {
				return nil, fmt.Errorf("business session for deviceId %s is not ready (%s)", req.DeviceID, session.currentState())
			}
			runnerToUse = session.runner
		}

		if err := configureRunnerForConnState(runnerToUse, cs); err != nil {
			return nil, err
		}

		go executeFlowAsync(srv, runnerToUse, req.Nodes, req.Edges)
		return map[string]string{"status": "started"}, nil
	})

	srv.Handle("flow.stop", func(payload json.RawMessage) (any, error) {
		legacyRunner.Stop()
		sessionManager.StopAllRunners()
		return map[string]string{"status": "stopped"}, nil
	})
}

func buildPacketConfig(req connConnectRequest) (codec.PacketConfig, string, error) {
	switch {
	case req.ParserMode == "pomelo":
		return codec.PacketConfig{
			Pomelo: &codec.PomeloConfig{
				UseRouteCompress: true,
			},
		}, "binary", nil

	case req.ParserMode == "tophero":
		return codec.PacketConfig{
			TopHero: &codec.TopHeroConfig{
				VerifySequence: true,
			},
		}, "compact", nil

	case len(req.FrameFields) > 0:
		isDue := false
		for _, field := range req.FrameFields {
			if strings.ToLower(field.Name) == "header" && field.Bytes == 1 {
				isDue = true
				break
			}
		}

		if isDue {
			var routeBytes int
			var seqBytes int
			for _, field := range req.FrameFields {
				if field.IsRoute {
					routeBytes += field.Bytes
				}
				if field.IsSeq || strings.ToLower(field.Name) == "seq" {
					seqBytes = field.Bytes
				}
			}
			return codec.PacketConfig{
				RouteBytes: routeBytes,
				SeqBytes:   seqBytes,
			}, "binary", nil
		}

		fields := make([]codec.FieldDef, len(req.FrameFields))
		for index, field := range req.FrameFields {
			fields[index] = codec.FieldDef{
				Name:    field.Name,
				Bytes:   field.Bytes,
				IsRoute: field.IsRoute,
				IsSeq:   field.IsSeq,
			}
		}
		fieldDriven, err := codec.NewFieldDrivenConfig(fields)
		if err != nil {
			return codec.PacketConfig{}, "", fmt.Errorf("invalid frame fields: %w", err)
		}
		fieldDriven.BigEndian = req.ByteOrder == "big"
		return codec.PacketConfig{FieldDriven: fieldDriven}, "binary", nil

	default:
		return codec.PacketConfig{RouteBytes: 2, SeqBytes: 2}, "binary", nil
	}
}

func configureRunnerForConnState(runner *engine.Runner, cs *api.ConnState) error {
	switch {
	case cs.ThriftResult != nil:
		runner.SetMessageEncoder(func(messageName string, fields map[string]any) ([]byte, error) {
			md := cs.ThriftResult.FindMessageDescriptor(messageName)
			if md == nil {
				return nil, fmt.Errorf("message %q not found", messageName)
			}
			if runner.ThriftProtocol() == "compact" {
				return codec.DynamicThriftCompactEncode(md, fields)
			}
			return codec.DynamicThriftEncode(md, fields)
		})
		runner.SetMessageDecoder(func(messageName string, data []byte) (map[string]any, error) {
			if runner.ThriftProtocol() == "compact" {
				return codec.DynamicThriftCompactDecode(data, cs.ThriftResult.FindMessageDescriptor(messageName))
			}
			return codec.DynamicThriftDecode(data, cs.ThriftResult.FindMessageDescriptor(messageName))
		})

	case cs.ParseResult != nil:
		runner.SetMessageEncoder(func(messageName string, fields map[string]any) ([]byte, error) {
			md := cs.ParseResult.FindMessageDescriptor(messageName)
			if md == nil {
				return nil, fmt.Errorf("message %q not found", messageName)
			}
			return codec.DynamicEncode(md, fields)
		})
		runner.SetMessageDecoder(func(messageName string, data []byte) (map[string]any, error) {
			return codec.DynamicDecode(data, cs.ParseResult.FindMessageDescriptor(messageName))
		})

	default:
		return fmt.Errorf("no schema imported for connection")
	}

	runner.SetResponseNameResolver(func(route uint32) string {
		key := fmt.Sprintf("%d", route)
		if mapping, ok := cs.RouteMappings[key]; ok && mapping.ResponseMsg != "" {
			return mapping.ResponseMsg
		}
		if cs.ParseResult != nil {
			if messageName := cs.ParseResult.FindMessageNameByID(route); messageName != "" {
				return messageName
			}
		}
		if cs.ThriftResult != nil {
			return cs.ThriftResult.FindMessageNameByID(route)
		}
		return ""
	})

	runner.SetStringRouteResponseNameResolver(func(route string) string {
		mapping, ok := cs.RouteMappings[route]
		if !ok {
			return ""
		}
		return mapping.ResponseMsg
	})

	runner.SetIncomingMessageNameResolver(func(route uint32, stringRoute string) string {
		if stringRoute != "" {
			if mapping, ok := cs.RouteMappings[stringRoute]; ok && mapping.ResponseMsg != "" {
				return mapping.ResponseMsg
			}
		}
		if cs.ParseResult != nil {
			if messageName := cs.ParseResult.FindMessageNameByID(route); messageName != "" {
				return messageName
			}
		}
		if cs.ThriftResult != nil {
			if messageName := cs.ThriftResult.FindMessageNameByID(route); messageName != "" {
				return messageName
			}
		}
		if mapping, ok := cs.RouteMappings[fmt.Sprintf("%d", route)]; ok {
			return mapping.ResponseMsg
		}
		return ""
	})

	return nil
}

func executeFlowAsync(srv *api.Server, runner *engine.Runner, nodes []engine.FlowNode, edges []engine.FlowEdge) {
	srv.Broadcast(api.ServerMessage{Event: "flow.started"})

	err := runner.Execute(context.Background(), nodes, edges, func(result engine.NodeResult) {
		if result.Success {
			srv.Broadcast(api.ServerMessage{
				Event:   "node.result",
				Payload: result,
			})
			return
		}
		srv.Broadcast(api.ServerMessage{
			Event:   "node.error",
			Payload: map[string]any{"nodeId": result.NodeID, "error": result.Error},
		})
	})
	if err != nil {
		srv.Broadcast(api.ServerMessage{
			Event:   "flow.error",
			Payload: map[string]any{"error": err.Error()},
		})
		return
	}

	srv.Broadcast(api.ServerMessage{Event: "flow.complete"})
}

func buildPacketLogPayload(runner *engine.Runner, pkt *codec.Packet, connectionID string, deviceID string, source string) (packetLogPayload, bool) {
	if pkt == nil || connectionID == "" || runner == nil {
		return packetLogPayload{}, false
	}

	messageName, data, err := runner.DecodeIncomingPacket(pkt)
	if err != nil || messageName == "" {
		return packetLogPayload{}, false
	}

	return packetLogPayload{
		ConnectionID: connectionID,
		DeviceID:     deviceID,
		Source:       source,
		Route:        pkt.Route,
		StringRoute:  pkt.StringRoute,
		Seq:          pkt.Seq,
		MessageName:  messageName,
		Data:         data,
	}, true
}

func emitPacketLogAsync(notify func(packetLogPayload), runner *engine.Runner, pkt *codec.Packet, connectionID string, deviceID string, source string) {
	if notify == nil || runner == nil || pkt == nil || connectionID == "" {
		return
	}

	pktCopy := &codec.Packet{
		Heartbeat:   pkt.Heartbeat,
		ExtCode:     pkt.ExtCode,
		Route:       pkt.Route,
		Seq:         pkt.Seq,
		StringRoute: pkt.StringRoute,
	}
	if len(pkt.Data) > 0 {
		pktCopy.Data = append([]byte(nil), pkt.Data...)
	}

	go func() {
		if payload, ok := buildPacketLogPayload(runner, pktCopy, connectionID, deviceID, source); ok {
			notify(payload)
		}
	}()
}
