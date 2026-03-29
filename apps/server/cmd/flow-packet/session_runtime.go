package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/flow-packet/server/internal/api"
	"github.com/flow-packet/server/internal/codec"
	"github.com/flow-packet/server/internal/engine"
	"github.com/flow-packet/server/internal/network"
	"github.com/flow-packet/server/internal/parser"
)

const (
	loginMessageShortName     = "CgLogIn"
	enterGameMessageShortName = "CgEnterGame"
	closeMessageShortName     = "CgClose"
	synchronizeTimeShortName  = "CgSynchronizeTime"
	loginTypeValue            = "test"
	sessionSeqBase            = uint32(32747)
	loginResponseTimeout      = 5 * time.Second
	synchronizeTimeInterval   = 8 * time.Minute
)

type connectionRuntimeConfig struct {
	ConnectionID   string
	Host           string
	Port           int
	Protocol       string
	ConnectTimeout time.Duration
	PacketConfig   codec.PacketConfig
	Heartbeat      bool
	ThriftProtocol string
}

type loginMessagePlan struct {
	MessageName         string
	Route               uint32
	StringRoute         string
	ResponseMessageName string
	Encode              func(deviceID string) ([]byte, error)
	Decode              func(data []byte) (map[string]any, error)
}

type syncMessagePlan struct {
	MessageName string
	Route       uint32
	StringRoute string
	Encode      func() ([]byte, error)
}

type sessionStatusPayload struct {
	ConnectionID string `json:"connectionId"`
	DeviceID     string `json:"deviceId"`
	State        string `json:"state"`
	Error        string `json:"error,omitempty"`
}

type flowSession struct {
	mu                sync.RWMutex
	key               string
	connectionID      string
	deviceID          string
	config            connectionRuntimeConfig
	client            network.Client
	runner            *engine.Runner
	heartbeat         *network.Heartbeat
	pomeloHandshakeCh chan []byte
	loginPlan         *loginMessagePlan
	enterGamePlan     *loginMessagePlan
	closePlan         *syncMessagePlan
	syncPlan          *syncMessagePlan
	syncStopCh        chan struct{}
	state             string
	lastError         string
	loggedIn          bool
	notifyStatus      func(payload sessionStatusPayload)
	notifyPacket      func(payload packetLogPayload)
	onTerminal        func(session *flowSession)
	terminalNotified  bool
}

func newFlowSession(config connectionRuntimeConfig, deviceID string, loginPlan *loginMessagePlan, enterGamePlan *loginMessagePlan, closePlan *syncMessagePlan, syncPlan *syncMessagePlan, notifyStatus func(payload sessionStatusPayload), notifyPacket func(payload packetLogPayload), onTerminal func(session *flowSession)) *flowSession {
	// TopHero business sessions use CgSynchronizeTime as the app-level heartbeat.
	// Disable raw transport heartbeat here to avoid sending heartbeat frames the server may not expect.
	if syncPlan != nil {
		config.Heartbeat = false
	}
	client := newRuntimeClient(config)
	runner := engine.NewRunner(config.PacketConfig)
	runner.SetThriftProtocol(config.ThriftProtocol)
	runner.SeqCtx().ResetTo(sessionSeqBase)

	session := &flowSession{
		key:               makeSessionKey(config.ConnectionID, deviceID),
		connectionID:      config.ConnectionID,
		deviceID:          deviceID,
		config:            config,
		client:            client,
		runner:            runner,
		heartbeat:         network.NewHeartbeat(network.DefaultHeartbeatConfig(), config.PacketConfig),
		pomeloHandshakeCh: make(chan []byte, 1),
		loginPlan:         loginPlan,
		enterGamePlan:     enterGamePlan,
		closePlan:         closePlan,
		syncPlan:          syncPlan,
		state:             "disconnected",
		notifyStatus:      notifyStatus,
		notifyPacket:      notifyPacket,
		onTerminal:        onTerminal,
	}

	runner.SetSendFunc(func(data []byte) error {
		return session.client.Send(data)
	})

	session.heartbeat.OnSend(func(data []byte) error {
		return session.client.Send(data)
	})
	session.heartbeat.OnTimeout(func() {
		_ = session.client.Disconnect()
	})

	client.OnReceive(session.handleReceive)
	client.OnConnect(session.handleConnect)
	client.OnDisconnect(session.handleDisconnect)

	return session
}

func (s *flowSession) handleReceive(_ network.Conn, data []byte) {
	pkt, err := codec.DecodeBytes(data, s.config.PacketConfig)
	if err != nil {
		s.setState("error", err.Error())
		return
	}
	if pkt.IsHeartbeat() {
		s.heartbeat.Feed()
		return
	}
	if s.config.PacketConfig.IsPomelo() && pkt.ExtCode != 0 {
		switch pkt.ExtCode {
		case codec.PomeloPacketHandshake:
			select {
			case s.pomeloHandshakeCh <- pkt.Data:
			default:
			}
		case codec.PomeloPacketKick:
			_ = s.client.Disconnect()
		}
		return
	}
	s.runner.HandleIncomingPacket(pkt)
	emitPacketLogAsync(s.notifyPacket, s.runner, pkt, s.connectionID, s.deviceID, "session")
}

func (s *flowSession) handleConnect(_ network.Conn) {
	if s.config.Heartbeat {
		s.heartbeat.Start()
	}
	s.mu.Lock()
	s.loggedIn = false
	s.terminalNotified = false
	s.mu.Unlock()
	s.setState("connected", "")
}

func (s *flowSession) handleDisconnect(_ network.Conn, err error) {
	s.heartbeat.Stop()
	s.stopSyncLoop()
	s.mu.Lock()
	s.loggedIn = false
	currentState := s.state
	s.mu.Unlock()
	if err != nil {
		s.setState("error", err.Error())
		s.notifyTerminalState()
		return
	}
	if currentState != "error" {
		s.setState("disconnected", "")
	}
	s.notifyTerminalState()
}

func (s *flowSession) connect() error {
	if s.client.State() == network.ConnStateConnected {
		return nil
	}

	s.setState("connecting", "")
	clearHandshakeChannel(s.pomeloHandshakeCh)

	addr := fmt.Sprintf("%s:%d", s.config.Host, s.config.Port)
	if err := s.client.Connect(addr); err != nil {
		s.setState("error", err.Error())
		return fmt.Errorf("connect session %s: %w", s.key, err)
	}

	if s.config.PacketConfig.IsPomelo() {
		if err := performPomeloHandshake(s.client, s.pomeloHandshakeCh); err != nil {
			_ = s.client.Disconnect()
			s.setState("error", err.Error())
			return err
		}
	}

	s.runner.SetPacketConfig(s.config.PacketConfig)
	s.runner.SetThriftProtocol(s.config.ThriftProtocol)
	s.runner.SeqCtx().ResetTo(sessionSeqBase)
	s.setState("connected", "")
	return nil
}

func (s *flowSession) ensureLoggedIn() error {
	s.mu.RLock()
	loggedIn := s.loggedIn
	s.mu.RUnlock()
	if loggedIn {
		s.setState("ready", "")
		return nil
	}

	if err := s.connect(); err != nil {
		return err
	}
	if s.loginPlan == nil {
		return fmt.Errorf("login message plan is not configured")
	}

	s.setState("logging_in", "")

	payload, err := s.loginPlan.Encode(s.deviceID)
	if err != nil {
		s.setState("error", err.Error())
		return fmt.Errorf("encode login %s: %w", s.deviceID, err)
	}

	seq, respCh := s.runner.SeqCtx().NextSeq()
	frame, err := codec.Encode(&codec.Packet{
		Route:       s.loginPlan.Route,
		StringRoute: s.loginPlan.StringRoute,
		Seq:         seq,
		Data:        payload,
	}, s.config.PacketConfig)
	if err != nil {
		s.setState("error", err.Error())
		return fmt.Errorf("encode login frame %s: %w", s.deviceID, err)
	}

	if err := s.client.Send(frame); err != nil {
		s.setState("error", err.Error())
		return fmt.Errorf("send login frame %s: %w", s.deviceID, err)
	}

	respData, err := s.runner.SeqCtx().WaitResponse(respCh, loginResponseTimeout)
	if err != nil {
		s.setState("error", err.Error())
		return fmt.Errorf("wait login response %s: %w", s.deviceID, err)
	}

	if s.loginPlan.Decode != nil {
		response, err := s.loginPlan.Decode(respData)
		if err != nil {
			s.setState("error", err.Error())
			return fmt.Errorf("decode login response %s: %w", s.deviceID, err)
		}
		if loginErr := extractLoginError(response); loginErr != "" {
			s.setState("error", loginErr)
			return fmt.Errorf("login rejected for %s: %s", s.deviceID, loginErr)
		}
	}

	if err := s.sendSynchronizeTime(); err != nil {
		s.setState("error", err.Error())
		return fmt.Errorf("send synchronize time %s: %w", s.deviceID, err)
	}

	if err := s.sendEnterGame(); err != nil {
		s.setState("error", err.Error())
		return fmt.Errorf("send enter game %s: %w", s.deviceID, err)
	}
	s.startSyncLoop()

	s.mu.Lock()
	s.loggedIn = true
	s.mu.Unlock()
	s.setState("ready", "")
	return nil
}

func (s *flowSession) logout() error {
	if err := s.sendClose(); err != nil {
		s.setState("error", err.Error())
		return fmt.Errorf("send close %s: %w", s.deviceID, err)
	}

	s.close()
	return nil
}

func (s *flowSession) dispose() {
	s.stopSyncLoop()
	s.runner.Stop()
	s.heartbeat.Stop()
	_ = s.client.Disconnect()
	s.notifyTerminalState()
}

func (s *flowSession) close() {
	s.dispose()
	s.setState("disconnected", "")
}

func (s *flowSession) sendEnterGame() error {
	if s.enterGamePlan == nil {
		return nil
	}

	payload, err := s.enterGamePlan.Encode(s.deviceID)
	if err != nil {
		return err
	}

	seq, respCh := s.runner.SeqCtx().NextSeq()
	frame, err := codec.Encode(&codec.Packet{
		Route:       s.enterGamePlan.Route,
		StringRoute: s.enterGamePlan.StringRoute,
		Seq:         seq,
		Data:        payload,
	}, s.config.PacketConfig)
	if err != nil {
		return err
	}

	if err := s.client.Send(frame); err != nil {
		return err
	}

	respData, err := s.runner.SeqCtx().WaitResponse(respCh, loginResponseTimeout)
	if err != nil {
		return err
	}

	if s.enterGamePlan.Decode != nil {
		if _, err := s.enterGamePlan.Decode(respData); err != nil {
			return err
		}
	}

	return nil
}

func (s *flowSession) sendClose() error {
	if s.closePlan == nil {
		return fmt.Errorf("close message plan is not configured")
	}

	payload, err := s.closePlan.Encode()
	if err != nil {
		return err
	}

	frame, err := codec.Encode(&codec.Packet{
		Route:       s.closePlan.Route,
		StringRoute: s.closePlan.StringRoute,
		Seq:         s.runner.SeqCtx().NextSeqValue(),
		Data:        payload,
	}, s.config.PacketConfig)
	if err != nil {
		return err
	}

	return s.client.Send(frame)
}

func (s *flowSession) sendSynchronizeTime() error {
	if s.syncPlan == nil {
		return nil
	}

	payload, err := s.syncPlan.Encode()
	if err != nil {
		return err
	}

	frame, err := codec.Encode(&codec.Packet{
		Route:       s.syncPlan.Route,
		StringRoute: s.syncPlan.StringRoute,
		Seq:         s.runner.SeqCtx().NextSeqValue(),
		Data:        payload,
	}, s.config.PacketConfig)
	if err != nil {
		return err
	}

	return s.client.Send(frame)
}

func (s *flowSession) startSyncLoop() {
	s.mu.Lock()
	if s.syncPlan == nil || s.syncStopCh != nil {
		s.mu.Unlock()
		return
	}
	stopCh := make(chan struct{})
	s.syncStopCh = stopCh
	s.mu.Unlock()

	go func() {
		ticker := time.NewTicker(synchronizeTimeInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				if err := s.sendSynchronizeTime(); err != nil {
					s.setState("error", err.Error())
				}
			case <-stopCh:
				return
			}
		}
	}()
}

func (s *flowSession) stopSyncLoop() {
	s.mu.Lock()
	stopCh := s.syncStopCh
	s.syncStopCh = nil
	s.mu.Unlock()

	if stopCh != nil {
		close(stopCh)
	}
}

func (s *flowSession) isReady() bool {
	s.mu.RLock()
	loggedIn := s.loggedIn
	state := s.state
	s.mu.RUnlock()
	return loggedIn && state == "ready" && s.client.State() == network.ConnStateConnected
}

func (s *flowSession) currentState() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.state
}

func (s *flowSession) setState(state string, lastError string) {
	s.mu.Lock()
	s.state = state
	s.lastError = lastError
	payload := sessionStatusPayload{
		ConnectionID: s.connectionID,
		DeviceID:     s.deviceID,
		State:        state,
		Error:        lastError,
	}
	notify := s.notifyStatus
	s.mu.Unlock()

	if notify != nil {
		notify(payload)
	}
}

func (s *flowSession) notifyTerminalState() {
	s.mu.Lock()
	if s.terminalNotified {
		s.mu.Unlock()
		return
	}
	s.terminalNotified = true
	onTerminal := s.onTerminal
	s.mu.Unlock()

	if onTerminal != nil {
		onTerminal(s)
	}
}

type flowSessionManager struct {
	mu           sync.RWMutex
	configs      map[string]connectionRuntimeConfig
	sessions     map[string]*flowSession
	notifyStatus func(payload sessionStatusPayload)
	notifyPacket func(payload packetLogPayload)
}

func newFlowSessionManager(notifyStatus func(payload sessionStatusPayload), notifyPacket func(payload packetLogPayload)) *flowSessionManager {
	return &flowSessionManager{
		configs:      make(map[string]connectionRuntimeConfig),
		sessions:     make(map[string]*flowSession),
		notifyStatus: notifyStatus,
		notifyPacket: notifyPacket,
	}
}

func (m *flowSessionManager) removeSessionIfSame(session *flowSession) {
	if session == nil {
		return
	}
	m.mu.Lock()
	if current := m.sessions[session.key]; current == session {
		delete(m.sessions, session.key)
	}
	m.mu.Unlock()
}

func (m *flowSessionManager) SetConnectionConfig(config connectionRuntimeConfig) {
	sessions := m.removeConnectionSessions(config.ConnectionID)

	m.mu.Lock()
	m.configs[config.ConnectionID] = config
	m.mu.Unlock()

	for _, session := range sessions {
		session.close()
	}
}

func (m *flowSessionManager) RemoveConnection(connectionID string) {
	sessions := m.removeConnectionSessions(connectionID)

	m.mu.Lock()
	delete(m.configs, connectionID)
	m.mu.Unlock()

	for _, session := range sessions {
		session.close()
	}
}

func (m *flowSessionManager) CloseAll() {
	m.mu.Lock()
	sessions := make([]*flowSession, 0, len(m.sessions))
	for key, session := range m.sessions {
		sessions = append(sessions, session)
		delete(m.sessions, key)
	}
	m.configs = make(map[string]connectionRuntimeConfig)
	m.mu.Unlock()

	for _, session := range sessions {
		session.close()
	}
}

func (m *flowSessionManager) StopAllRunners() {
	m.mu.RLock()
	sessions := make([]*flowSession, 0, len(m.sessions))
	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}
	m.mu.RUnlock()

	for _, session := range sessions {
		session.runner.Stop()
	}
}

func (m *flowSessionManager) EnsureSession(connectionID string, deviceID string, cs *api.ConnState) (*flowSession, error) {
	key := makeSessionKey(connectionID, deviceID)

	m.mu.RLock()
	session := m.sessions[key]
	config, ok := m.configs[connectionID]
	m.mu.RUnlock()
	if session != nil {
		return session, nil
	}
	if !ok {
		return nil, fmt.Errorf("connection %s is not ready for device sessions", connectionID)
	}

	loginPlan, err := buildLoginMessagePlan(cs, config.ThriftProtocol)
	if err != nil {
		return nil, err
	}

	enterGamePlan, err := buildEnterGameMessagePlan(cs, config.ThriftProtocol)
	if err != nil {
		return nil, err
	}

	closePlan, err := buildCloseMessagePlan(cs, config.ThriftProtocol)
	if err != nil {
		return nil, err
	}

	syncPlan, err := buildSynchronizeTimePlan(cs, config.ThriftProtocol)
	if err != nil {
		return nil, err
	}

	session = newFlowSession(config, deviceID, loginPlan, enterGamePlan, closePlan, syncPlan, m.notifyStatus, m.notifyPacket, m.removeSessionIfSame)
	if err := configureRunnerForConnState(session.runner, cs); err != nil {
		session.close()
		return nil, err
	}

	m.mu.Lock()
	if existing := m.sessions[key]; existing != nil {
		m.mu.Unlock()
		session.close()
		return existing, nil
	}
	m.sessions[key] = session
	m.mu.Unlock()

	return session, nil
}

func (m *flowSessionManager) GetSession(connectionID string, deviceID string) *flowSession {
	key := makeSessionKey(connectionID, deviceID)
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.sessions[key]
}

func (m *flowSessionManager) LogoutSession(connectionID string, deviceID string) error {
	key := makeSessionKey(connectionID, deviceID)
	m.mu.RLock()
	session := m.sessions[key]
	m.mu.RUnlock()
	if session == nil {
		return fmt.Errorf("business session for deviceId %s is not logged in", deviceID)
	}

	if err := session.logout(); err != nil {
		return err
	}

	m.mu.Lock()
	if m.sessions[key] == session {
		delete(m.sessions, key)
	}
	m.mu.Unlock()
	return nil
}

func (m *flowSessionManager) removeConnectionSessions(connectionID string) []*flowSession {
	m.mu.Lock()
	sessions := make([]*flowSession, 0)
	for key, session := range m.sessions {
		if session.connectionID != connectionID {
			continue
		}
		sessions = append(sessions, session)
		delete(m.sessions, key)
	}
	m.mu.Unlock()
	return sessions
}

func newRuntimeClient(config connectionRuntimeConfig) network.Client {
	reconnectCfg := network.ReconnectConfig{Enable: false}

	if config.Protocol == "ws" {
		client := network.NewWSClient(config.PacketConfig)
		client.SetReconnectConfig(reconnectCfg)
		client.SetConnectTimeout(config.ConnectTimeout)
		return client
	}

	client := network.NewTCPClient(config.PacketConfig)
	client.SetReconnectConfig(reconnectCfg)
	client.SetConnectTimeout(config.ConnectTimeout)
	return client
}

func makeSessionKey(connectionID string, deviceID string) string {
	return connectionID + "::" + deviceID
}

func buildLoginMessagePlan(cs *api.ConnState, thriftProtocol string) (*loginMessagePlan, error) {
	switch {
	case cs.ThriftResult != nil:
		message, ok := findMessageByShortName(cs.ThriftResult.AllMessages(), loginMessageShortName)
		if !ok {
			return nil, fmt.Errorf("message %s not found", loginMessageShortName)
		}
		route, stringRoute, err := resolveMessageRoute(cs, message.Name, message.MessageID)
		if err != nil {
			return nil, err
		}
		descriptor := cs.ThriftResult.FindMessageDescriptor(message.Name)
		if descriptor == nil {
			return nil, fmt.Errorf("message descriptor %s not found", message.Name)
		}

		responseMessageName := resolveLoginResponseMessageName(cs, route, stringRoute, message.Name)
		var decodeFn func(data []byte) (map[string]any, error)
		if responseMessageName != "" {
			if responseDescriptor := cs.ThriftResult.FindMessageDescriptor(responseMessageName); responseDescriptor != nil {
				decodeFn = func(data []byte) (map[string]any, error) {
					if thriftProtocol == "compact" {
						return codec.DynamicThriftCompactDecode(data, responseDescriptor)
					}
					return codec.DynamicThriftDecode(data, responseDescriptor)
				}
			}
		}

		return &loginMessagePlan{
			MessageName:         message.Name,
			Route:               route,
			StringRoute:         stringRoute,
			ResponseMessageName: responseMessageName,
			Encode: func(deviceID string) ([]byte, error) {
				fields := map[string]any{
					"deviceId":  deviceID,
					"loginType": loginTypeValue,
				}
				if thriftProtocol == "compact" {
					return codec.DynamicThriftCompactEncode(descriptor, fields)
				}
				return codec.DynamicThriftEncode(descriptor, fields)
			},
			Decode: decodeFn,
		}, nil

	case cs.ParseResult != nil:
		message, ok := findMessageByShortName(cs.ParseResult.AllMessages(), loginMessageShortName)
		if !ok {
			return nil, fmt.Errorf("message %s not found", loginMessageShortName)
		}
		route, stringRoute, err := resolveMessageRoute(cs, message.Name, message.MessageID)
		if err != nil {
			return nil, err
		}
		descriptor := cs.ParseResult.FindMessageDescriptor(message.Name)
		if descriptor == nil {
			return nil, fmt.Errorf("message descriptor %s not found", message.Name)
		}

		responseMessageName := resolveLoginResponseMessageName(cs, route, stringRoute, message.Name)
		var decodeFn func(data []byte) (map[string]any, error)
		if responseMessageName != "" {
			if responseDescriptor := cs.ParseResult.FindMessageDescriptor(responseMessageName); responseDescriptor != nil {
				decodeFn = func(data []byte) (map[string]any, error) {
					return codec.DynamicDecode(data, responseDescriptor)
				}
			}
		}

		return &loginMessagePlan{
			MessageName:         message.Name,
			Route:               route,
			StringRoute:         stringRoute,
			ResponseMessageName: responseMessageName,
			Encode: func(deviceID string) ([]byte, error) {
				return codec.DynamicEncode(descriptor, map[string]any{
					"deviceId":  deviceID,
					"loginType": loginTypeValue,
				})
			},
			Decode: decodeFn,
		}, nil
	default:
		return nil, fmt.Errorf("no schema imported for connection")
	}
}

func buildEnterGameMessagePlan(cs *api.ConnState, thriftProtocol string) (*loginMessagePlan, error) {
	switch {
	case cs.ThriftResult != nil:
		message, ok := findMessageByShortName(cs.ThriftResult.AllMessages(), enterGameMessageShortName)
		if !ok {
			return nil, nil
		}
		route, stringRoute, err := resolveMessageRoute(cs, message.Name, message.MessageID)
		if err != nil {
			return nil, err
		}
		descriptor := cs.ThriftResult.FindMessageDescriptor(message.Name)
		if descriptor == nil {
			return nil, fmt.Errorf("message descriptor %s not found", message.Name)
		}

		responseMessageName := resolveLoginResponseMessageName(cs, route, stringRoute, message.Name)
		var decodeFn func(data []byte) (map[string]any, error)
		if responseMessageName != "" {
			if responseDescriptor := cs.ThriftResult.FindMessageDescriptor(responseMessageName); responseDescriptor != nil {
				decodeFn = func(data []byte) (map[string]any, error) {
					if thriftProtocol == "compact" {
						return codec.DynamicThriftCompactDecode(data, responseDescriptor)
					}
					return codec.DynamicThriftDecode(data, responseDescriptor)
				}
			}
		}

		return &loginMessagePlan{
			MessageName:         message.Name,
			Route:               route,
			StringRoute:         stringRoute,
			ResponseMessageName: responseMessageName,
			Encode: func(deviceID string) ([]byte, error) {
				_ = deviceID
				if thriftProtocol == "compact" {
					return codec.DynamicThriftCompactEncode(descriptor, map[string]any{})
				}
				return codec.DynamicThriftEncode(descriptor, map[string]any{})
			},
			Decode: decodeFn,
		}, nil

	case cs.ParseResult != nil:
		message, ok := findMessageByShortName(cs.ParseResult.AllMessages(), enterGameMessageShortName)
		if !ok {
			return nil, nil
		}
		route, stringRoute, err := resolveMessageRoute(cs, message.Name, message.MessageID)
		if err != nil {
			return nil, err
		}
		descriptor := cs.ParseResult.FindMessageDescriptor(message.Name)
		if descriptor == nil {
			return nil, fmt.Errorf("message descriptor %s not found", message.Name)
		}

		responseMessageName := resolveLoginResponseMessageName(cs, route, stringRoute, message.Name)
		var decodeFn func(data []byte) (map[string]any, error)
		if responseMessageName != "" {
			if responseDescriptor := cs.ParseResult.FindMessageDescriptor(responseMessageName); responseDescriptor != nil {
				decodeFn = func(data []byte) (map[string]any, error) {
					return codec.DynamicDecode(data, responseDescriptor)
				}
			}
		}

		return &loginMessagePlan{
			MessageName:         message.Name,
			Route:               route,
			StringRoute:         stringRoute,
			ResponseMessageName: responseMessageName,
			Encode: func(deviceID string) ([]byte, error) {
				_ = deviceID
				return codec.DynamicEncode(descriptor, map[string]any{})
			},
			Decode: decodeFn,
		}, nil
	default:
		return nil, fmt.Errorf("no schema imported for connection")
	}
}

func buildCloseMessagePlan(cs *api.ConnState, thriftProtocol string) (*syncMessagePlan, error) {
	switch {
	case cs.ThriftResult != nil:
		message, ok := findMessageByShortName(cs.ThriftResult.AllMessages(), closeMessageShortName)
		if !ok {
			return nil, fmt.Errorf("message %s not found", closeMessageShortName)
		}
		route, stringRoute, err := resolveMessageRoute(cs, message.Name, message.MessageID)
		if err != nil {
			return nil, err
		}
		descriptor := cs.ThriftResult.FindMessageDescriptor(message.Name)
		if descriptor == nil {
			return nil, fmt.Errorf("message descriptor %s not found", message.Name)
		}
		return &syncMessagePlan{
			MessageName: message.Name,
			Route:       route,
			StringRoute: stringRoute,
			Encode: func() ([]byte, error) {
				if thriftProtocol == "compact" {
					return codec.DynamicThriftCompactEncode(descriptor, map[string]any{})
				}
				return codec.DynamicThriftEncode(descriptor, map[string]any{})
			},
		}, nil

	case cs.ParseResult != nil:
		message, ok := findMessageByShortName(cs.ParseResult.AllMessages(), closeMessageShortName)
		if !ok {
			return nil, fmt.Errorf("message %s not found", closeMessageShortName)
		}
		route, stringRoute, err := resolveMessageRoute(cs, message.Name, message.MessageID)
		if err != nil {
			return nil, err
		}
		descriptor := cs.ParseResult.FindMessageDescriptor(message.Name)
		if descriptor == nil {
			return nil, fmt.Errorf("message descriptor %s not found", message.Name)
		}
		return &syncMessagePlan{
			MessageName: message.Name,
			Route:       route,
			StringRoute: stringRoute,
			Encode: func() ([]byte, error) {
				return codec.DynamicEncode(descriptor, map[string]any{})
			},
		}, nil
	default:
		return nil, fmt.Errorf("no schema imported for connection")
	}
}

func buildSynchronizeTimePlan(cs *api.ConnState, thriftProtocol string) (*syncMessagePlan, error) {
	switch {
	case cs.ThriftResult != nil:
		message, ok := findMessageByShortName(cs.ThriftResult.AllMessages(), synchronizeTimeShortName)
		if !ok {
			return nil, fmt.Errorf("message %s not found", synchronizeTimeShortName)
		}
		route, stringRoute, err := resolveMessageRoute(cs, message.Name, message.MessageID)
		if err != nil {
			return nil, err
		}
		descriptor := cs.ThriftResult.FindMessageDescriptor(message.Name)
		if descriptor == nil {
			return nil, fmt.Errorf("message descriptor %s not found", message.Name)
		}
		return &syncMessagePlan{
			MessageName: message.Name,
			Route:       route,
			StringRoute: stringRoute,
			Encode: func() ([]byte, error) {
				fields := map[string]any{
					"clientTime": int(time.Now().Unix()),
				}
				if thriftProtocol == "compact" {
					return codec.DynamicThriftCompactEncode(descriptor, fields)
				}
				return codec.DynamicThriftEncode(descriptor, fields)
			},
		}, nil

	case cs.ParseResult != nil:
		message, ok := findMessageByShortName(cs.ParseResult.AllMessages(), synchronizeTimeShortName)
		if !ok {
			return nil, fmt.Errorf("message %s not found", synchronizeTimeShortName)
		}
		route, stringRoute, err := resolveMessageRoute(cs, message.Name, message.MessageID)
		if err != nil {
			return nil, err
		}
		descriptor := cs.ParseResult.FindMessageDescriptor(message.Name)
		if descriptor == nil {
			return nil, fmt.Errorf("message descriptor %s not found", message.Name)
		}
		return &syncMessagePlan{
			MessageName: message.Name,
			Route:       route,
			StringRoute: stringRoute,
			Encode: func() ([]byte, error) {
				return codec.DynamicEncode(descriptor, map[string]any{
					"clientTime": int(time.Now().Unix()),
				})
			},
		}, nil
	default:
		return nil, fmt.Errorf("no schema imported for connection")
	}
}

func resolveLoginResponseMessageName(cs *api.ConnState, route uint32, stringRoute string, requestMessageName string) string {
	if stringRoute != "" {
		if mapping, ok := cs.RouteMappings[stringRoute]; ok && mapping.ResponseMsg != "" {
			return mapping.ResponseMsg
		}
	}
	if route != 0 {
		if mapping, ok := cs.RouteMappings[fmt.Sprintf("%d", route)]; ok && mapping.ResponseMsg != "" {
			return mapping.ResponseMsg
		}
	}
	return inferResponseMessageName(requestMessageName)
}

func inferResponseMessageName(requestMessageName string) string {
	switch {
	case strings.HasPrefix(requestMessageName, "Cg"):
		return "Gc" + strings.TrimPrefix(requestMessageName, "Cg")
	case strings.HasPrefix(requestMessageName, "Cs"):
		return "Sc" + strings.TrimPrefix(requestMessageName, "Cs")
	default:
		return ""
	}
}

func extractLoginError(response map[string]any) string {
	if len(response) == 0 {
		return ""
	}
	if success, ok := asBool(response["success"]); ok && !success {
		for _, key := range []string{"message", "msg", "error", "reason"} {
			if msg, ok := response[key].(string); ok && strings.TrimSpace(msg) != "" {
				return strings.TrimSpace(msg)
			}
		}
		return "login rejected"
	}
	return ""
}

func asBool(value any) (bool, bool) {
	switch typed := value.(type) {
	case bool:
		return typed, true
	case int:
		return typed != 0, true
	case int8:
		return typed != 0, true
	case int16:
		return typed != 0, true
	case int32:
		return typed != 0, true
	case int64:
		return typed != 0, true
	case uint:
		return typed != 0, true
	case uint8:
		return typed != 0, true
	case uint16:
		return typed != 0, true
	case uint32:
		return typed != 0, true
	case uint64:
		return typed != 0, true
	default:
		return false, false
	}
}

func findMessageByShortName(messages []parser.MessageInfo, shortName string) (parser.MessageInfo, bool) {
	for _, message := range messages {
		if message.ShortName == shortName {
			return message, true
		}
	}
	return parser.MessageInfo{}, false
}

func resolveMessageRoute(cs *api.ConnState, messageName string, fallbackRoute uint32) (uint32, string, error) {
	if fallbackRoute != 0 {
		return fallbackRoute, "", nil
	}

	for _, mapping := range cs.RouteMappings {
		if mapping.RequestMsg != messageName {
			continue
		}
		if mapping.Route != 0 || mapping.StringRoute != "" {
			return mapping.Route, mapping.StringRoute, nil
		}
	}

	return 0, "", fmt.Errorf("route for message %s not found", messageName)
}

func performPomeloHandshake(client network.Client, handshakeCh chan []byte) error {
	clearHandshakeChannel(handshakeCh)

	payload := []byte(`{"sys":{"type":"flow-packet","version":"1.0.0"},"user":{}}`)
	if err := client.Send(codec.PomeloEncodeHandshake(payload)); err != nil {
		return fmt.Errorf("pomelo handshake send failed: %w", err)
	}

	select {
	case hsData := <-handshakeCh:
		var hsResp struct {
			Code int `json:"code"`
			Sys  struct {
				Heartbeat int            `json:"heartbeat"`
				Dict      map[string]int `json:"dict"`
			} `json:"sys"`
		}
		if err := json.Unmarshal(hsData, &hsResp); err != nil {
			return fmt.Errorf("pomelo handshake parse failed: %w", err)
		}
		if hsResp.Code != 200 {
			return fmt.Errorf("pomelo handshake rejected: code %d", hsResp.Code)
		}
	case <-time.After(10 * time.Second):
		return fmt.Errorf("pomelo handshake timeout")
	}

	if err := client.Send(codec.PomeloEncodeHandshakeAck()); err != nil {
		return fmt.Errorf("pomelo handshake ack failed: %w", err)
	}

	return nil
}

func clearHandshakeChannel(handshakeCh chan []byte) {
	for {
		select {
		case <-handshakeCh:
		default:
			return
		}
	}
}
