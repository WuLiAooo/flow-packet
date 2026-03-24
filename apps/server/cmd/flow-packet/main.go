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

func main() {
	// 工作目录
	workDir, err := os.UserConfigDir()
	if err != nil {
		workDir = os.TempDir()
	}
	dataDir := filepath.Join(workDir, "flow-packet")

	// 协议配置
	packetCfg := codec.PacketConfig{
		RouteBytes: 2,
		SeqBytes:   2,
	}

	// 初始化 TCP 和 WebSocket 客户端
	tcpClient := network.NewTCPClient(packetCfg)
	wsClient := network.NewWSClient(packetCfg)

	// activeClient 指向当前活跃的客户端, 默认为 TCP
	var activeClient network.Client = tcpClient

	// 初始化执行引擎
	runner := engine.NewRunner(packetCfg)
	runner.SetSendFunc(func(data []byte) error {
		return activeClient.Send(data)
	})

	// 初始化 API 服务
	srv := api.NewServer()
	appState := api.NewAppState(dataDir)
	api.RegisterHandlers(srv, appState)

	// 心跳模块
	hb := network.NewHeartbeat(network.DefaultHeartbeatConfig(), packetCfg)
	hb.OnSend(func(data []byte) error {
		return activeClient.Send(data)
	})
	hb.OnTimeout(func() {
		activeClient.Disconnect()
	})

	// Pomelo 握手响应通道
	pomeloHandshakeCh := make(chan []byte, 1)

	// 注册连接管理 handlers
	registerConnHandlers(srv, tcpClient, wsClient, &activeClient, &packetCfg, runner, hb, pomeloHandshakeCh)

	// 注册流程执行 handlers
	registerFlowHandlers(srv, runner, appState)

	// 收包回调 -> 匹配 seq 响应
	// 注意: 闭包捕获 packetCfg 变量(而非值), registerConnHandlers 通过指针更新后,
	// 此处下次调用即使用新配置
	onReceive := func(conn network.Conn, data []byte) {
		pkt, err := codec.DecodeBytes(data, packetCfg)
		if err != nil {
			return
		}
		if pkt.IsHeartbeat() {
			hb.Feed()
			return
		}
		// Pomelo 控制包处理
		if packetCfg.IsPomelo() && pkt.ExtCode != 0 {
			switch pkt.ExtCode {
			case codec.PomeloPacketHandshake:
				select {
				case pomeloHandshakeCh <- pkt.Data:
				default:
				}
			case codec.PomeloPacketKick:
				activeClient.Disconnect()
			}
			return
		}
		// 先精确匹配 seq; 若服务端不回传 seq(seq=0), 回退到匹配最早的等待请求
		if !runner.SeqCtx().Resolve(pkt.Seq, pkt.Data) {
			runner.SeqCtx().ResolveFirst(pkt.Data)
		}
	}

	// 连接状态推送
	onConnect := func(conn network.Conn) {
		hb.Start()
		srv.Broadcast(api.ServerMessage{
			Event:   "conn.status",
			Payload: map[string]any{"state": "connected", "addr": conn.RemoteAddr().String()},
		})
	}
	onDisconnect := func(conn network.Conn, err error) {
		hb.Stop()
		srv.Broadcast(api.ServerMessage{
			Event:   "conn.status",
			Payload: map[string]any{"state": "disconnected"},
		})
	}

	// 为 TCP 和 WebSocket 客户端注册相同的回调
	tcpClient.OnReceive(onReceive)
	tcpClient.OnConnect(onConnect)
	tcpClient.OnDisconnect(onDisconnect)
	wsClient.OnReceive(onReceive)
	wsClient.OnConnect(onConnect)
	wsClient.OnDisconnect(onDisconnect)

	// 启动 HTTP/WS 服务, 优先使用固定端口, 失败时回退到动态端口
	actualPort, err := srv.Start(58996)
	if err != nil {
		// 固定端口被占用, 回退到动态端口
		actualPort, err = srv.Start(0)
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to start server: %v\n", err)
			os.Exit(1)
		}
	}
	// 输出端口号供 Electron 主进程捕获
	fmt.Printf("PORT:%d\n", actualPort)

	// 等待退出信号
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	// 优雅退出
	tcpClient.Disconnect()
	wsClient.Disconnect()
	srv.Stop()
}

func registerConnHandlers(srv *api.Server, tcpClient *network.TCPClient, wsClient *network.WSClient, activeClient *network.Client, packetCfg *codec.PacketConfig, runner *engine.Runner, hb *network.Heartbeat, pomeloHandshakeCh chan []byte) {
	// applyConfig 将新的 PacketConfig 同步到所有组件
	applyConfig := func(newCfg codec.PacketConfig) {
		*packetCfg = newCfg
		tcpClient.SetPacketConfig(newCfg)
		wsClient.SetPacketConfig(newCfg)
		runner.SetPacketConfig(newCfg)
	}

	srv.Handle("conn.connect", func(payload json.RawMessage) (any, error) {
		var req struct {
			Host        string `json:"host"`
			Port        int    `json:"port"`
			Protocol    string `json:"protocol"`
			Timeout     int    `json:"timeout"`
			Reconnect   bool   `json:"reconnect"`
			Heartbeat   bool   `json:"heartbeat"`
			ByteOrder   string `json:"byteOrder"`
			ParserMode  string `json:"parserMode"`
			FrameFields []struct {
				Name    string `json:"name"`
				Bytes   int    `json:"bytes"`
				IsRoute bool   `json:"isRoute"`
				IsSeq   bool   `json:"isSeq"`
			} `json:"frameFields"`
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid payload: %w", err)
		}

		// 先停止心跳并断开当前活跃连接
		hb.Stop()
		(*activeClient).Disconnect()

		// 清空握手通道
		select {
		case <-pomeloHandshakeCh:
		default:
		}

		// Pomelo 模式
		if req.ParserMode == "pomelo" {
			newCfg := codec.PacketConfig{
				Pomelo: &codec.PomeloConfig{
					UseRouteCompress: true,
				},
			}
			runner.SetThriftProtocol("binary")
			applyConfig(newCfg)
		} else if req.ParserMode == "tophero" {
			runner.SetThriftProtocol("compact")
			applyConfig(codec.PacketConfig{
				TopHero: &codec.TopHeroConfig{
					VerifySequence: true,
				},
			})
		} else if len(req.FrameFields) > 0 {
			runner.SetThriftProtocol("binary")
			// 根据 frameFields 动态计算 PacketConfig
			// Due 检测: 存在 name=="header" && bytes==1 -> legacy 模式
			isDue := false
			for _, f := range req.FrameFields {
				if strings.ToLower(f.Name) == "header" && f.Bytes == 1 {
					isDue = true
					break
				}
			}

			if isDue {
				// Legacy Due 模式: 只计算 RouteBytes/SeqBytes
				var routeBytes, seqBytes int
				for _, f := range req.FrameFields {
					if f.IsRoute {
						routeBytes += f.Bytes
					}
					if f.IsSeq || strings.ToLower(f.Name) == "seq" {
						seqBytes = f.Bytes
					}
				}
				applyConfig(codec.PacketConfig{
					RouteBytes: routeBytes,
					SeqBytes:   seqBytes,
				})
			} else {
				// 字段驱动模式
				fields := make([]codec.FieldDef, len(req.FrameFields))
				for i, f := range req.FrameFields {
					fields[i] = codec.FieldDef{
						Name:    f.Name,
						Bytes:   f.Bytes,
						IsRoute: f.IsRoute,
						IsSeq:   f.IsSeq,
					}
				}
				fdCfg, err := codec.NewFieldDrivenConfig(fields)
				if err != nil {
					return nil, fmt.Errorf("invalid frame fields: %w", err)
				}
				fdCfg.BigEndian = req.ByteOrder == "big"
				applyConfig(codec.PacketConfig{
					FieldDriven: fdCfg,
				})
			}
		} else {
			runner.SetThriftProtocol("binary")
		}

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

		// 根据请求配置心跳
		if req.Heartbeat || packetCfg.IsPomelo() {
			hb.SetEnable(true)
			hb.SetPacketConfig(*packetCfg)
		} else {
			hb.SetEnable(false)
		}

		// 根据 protocol 选择客户端
		if req.Protocol == "ws" {
			*activeClient = wsClient
			wsClient.SetReconnectConfig(reconnectCfg)
			wsClient.SetConnectTimeout(connectTimeout)
		} else {
			*activeClient = tcpClient
			tcpClient.SetReconnectConfig(reconnectCfg)
			tcpClient.SetConnectTimeout(connectTimeout)
		}

		fmt.Printf("[conn.connect] protocol=%s addr=%s timeout=%s parser=%s\n", req.Protocol, addr, connectTimeout, req.ParserMode)
		if err := (*activeClient).Connect(addr); err != nil {
			return nil, fmt.Errorf("connect failed: %w", err)
		}
		fmt.Printf("[conn.connect] connected addr=%s state=%s\n", addr, (*activeClient).State().String())

		// Pomelo 握手流程
		if packetCfg.IsPomelo() {
			hsPayload := []byte(`{"sys":{"type":"flow-packet","version":"1.0.0"},"user":{}}`)
			if err := (*activeClient).Send(codec.PomeloEncodeHandshake(hsPayload)); err != nil {
				(*activeClient).Disconnect()
				return nil, fmt.Errorf("pomelo handshake send failed: %w", err)
			}

			// 等待握手响应
			select {
			case hsData := <-pomeloHandshakeCh:
				var hsResp struct {
					Code int `json:"code"`
					Sys  struct {
						Heartbeat int            `json:"heartbeat"`
						Dict      map[string]int `json:"dict"`
					} `json:"sys"`
				}
				if err := json.Unmarshal(hsData, &hsResp); err != nil {
					(*activeClient).Disconnect()
					return nil, fmt.Errorf("pomelo handshake parse failed: %w", err)
				}
				if hsResp.Code != 200 {
					(*activeClient).Disconnect()
					return nil, fmt.Errorf("pomelo handshake rejected: code %d", hsResp.Code)
				}
				fmt.Printf("[pomelo] handshake ok, heartbeat=%ds, routes=%d\n",
					hsResp.Sys.Heartbeat, len(hsResp.Sys.Dict))

			case <-time.After(10 * time.Second):
				(*activeClient).Disconnect()
				return nil, fmt.Errorf("pomelo handshake timeout")
			}

			// 发送握手确认
			if err := (*activeClient).Send(codec.PomeloEncodeHandshakeAck()); err != nil {
				(*activeClient).Disconnect()
				return nil, fmt.Errorf("pomelo handshake ack failed: %w", err)
			}
		}

		return map[string]string{"status": "connected"}, nil
	})

	srv.Handle("conn.disconnect", func(payload json.RawMessage) (any, error) {
		if err := (*activeClient).Disconnect(); err != nil {
			return nil, fmt.Errorf("disconnect failed: %w", err)
		}
		return map[string]string{"status": "disconnected"}, nil
	})

	srv.Handle("conn.status", func(payload json.RawMessage) (any, error) {
		return map[string]string{"state": (*activeClient).State().String()}, nil
	})
}

func registerFlowHandlers(srv *api.Server, runner *engine.Runner, state *api.AppState) {
	srv.Handle("flow.execute", func(payload json.RawMessage) (any, error) {
		var req struct {
			ConnectionID string            `json:"connectionId"`
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
			return nil, fmt.Errorf("no schema imported for connection")
		}

		runner.SetResponseNameResolver(func(route uint32) string {
			key := fmt.Sprintf("%d", route)
			mapping, ok := cs.RouteMappings[key]
			if !ok {
				if cs.ThriftResult != nil {
					return cs.ThriftResult.FindMessageNameByID(route)
				}
				return ""
			}
			return mapping.ResponseMsg
		})

		runner.SetStringRouteResponseNameResolver(func(route string) string {
			mapping, ok := cs.RouteMappings[route]
			if !ok {
				return ""
			}
			return mapping.ResponseMsg
		})

		go func() {
			srv.Broadcast(api.ServerMessage{Event: "flow.started"})

			err := runner.Execute(context.Background(), req.Nodes, req.Edges, func(result engine.NodeResult) {
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
		}()

		return map[string]string{"status": "started"}, nil
	})

	srv.Handle("flow.stop", func(payload json.RawMessage) (any, error) {
		runner.Stop()
		return map[string]string{"status": "stopped"}, nil
	})
}
