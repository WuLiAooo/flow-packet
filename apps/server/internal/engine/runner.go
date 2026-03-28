package engine

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/flow-packet/server/internal/codec"
)

const (
	FlowNodeTypeRequest      = "request"
	FlowNodeTypeWaitResponse = "wait_response"
	FlowNodeTypeComment      = "comment"
)

type FlowNode struct {
	ID          string         `json:"id"`
	Type        string         `json:"type,omitempty"`
	MessageName string         `json:"messageName"`
	Route       uint32         `json:"route"`
	StringRoute string         `json:"stringRoute"`
	Fields      map[string]any `json:"fields"`
}

type FlowEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

type NodeResult struct {
	NodeID      string         `json:"nodeId"`
	NodeType    string         `json:"nodeType,omitempty"`
	Success     bool           `json:"success"`
	RequestMsg  string         `json:"requestMsg,omitempty"`
	ResponseMsg string         `json:"responseMsg,omitempty"`
	Request     map[string]any `json:"request,omitempty"`
	Response    map[string]any `json:"response,omitempty"`
	Error       string         `json:"error,omitempty"`
	Duration    int64          `json:"duration"`
}

type NodeCallback func(result NodeResult)

type MessageEncoder func(messageName string, fields map[string]any) ([]byte, error)

type MessageDecoder func(messageName string, data []byte) (map[string]any, error)

type ResponseNameResolver func(route uint32) string

type StringRouteResponseNameResolver func(route string) string

type IncomingMessageNameResolver func(route uint32, stringRoute string) string

type executionPlan struct {
	order                  []string
	observerWaitsByRequest map[string][]string
	requestHasAttachedWait map[string]bool
}

type Runner struct {
	mu                     sync.Mutex
	running                bool
	cancel                 context.CancelFunc
	seqCtx                 *SeqContext
	packetCfg              codec.PacketConfig
	thriftProtocol         string
	timeout                time.Duration
	sendFn                 func(data []byte) error
	encoder                MessageEncoder
	decoder                MessageDecoder
	responseResolver       ResponseNameResolver
	stringResponseResolver StringRouteResponseNameResolver
	incomingNameResolver   IncomingMessageNameResolver
	inboxMu                sync.Mutex
	inbox                  []*codec.Packet
	inboxSignal            chan struct{}
	observerMu             sync.Mutex
	observerWaits          map[string]*FlowNode
	callbackMu             sync.Mutex
	nodeCallback           NodeCallback
}

func NewRunner(packetCfg codec.PacketConfig) *Runner {
	return &Runner{
		seqCtx:         NewSeqContext(),
		packetCfg:      packetCfg,
		thriftProtocol: "binary",
		timeout:        5 * time.Second,
		inboxSignal:    make(chan struct{}, 1),
		observerWaits:  make(map[string]*FlowNode),
	}
}

func (r *Runner) SetPacketConfig(cfg codec.PacketConfig) {
	r.packetCfg = cfg
}

func (r *Runner) SetThriftProtocol(protocol string) {
	if protocol == "" {
		protocol = "binary"
	}
	r.thriftProtocol = protocol
}

func (r *Runner) ThriftProtocol() string {
	if r.thriftProtocol == "" {
		return "binary"
	}
	return r.thriftProtocol
}

func (r *Runner) SetSendFunc(fn func(data []byte) error) {
	r.sendFn = fn
}

func (r *Runner) SetMessageEncoder(encoder MessageEncoder) {
	r.encoder = encoder
}

func (r *Runner) SetMessageDecoder(decoder MessageDecoder) {
	r.decoder = decoder
}

func (r *Runner) SetResponseNameResolver(resolver ResponseNameResolver) {
	r.responseResolver = resolver
}

func (r *Runner) SetStringRouteResponseNameResolver(resolver StringRouteResponseNameResolver) {
	r.stringResponseResolver = resolver
}

func (r *Runner) SetIncomingMessageNameResolver(resolver IncomingMessageNameResolver) {
	r.incomingNameResolver = resolver
}

func (r *Runner) SetTimeout(d time.Duration) {
	r.timeout = d
}

func (r *Runner) SeqCtx() *SeqContext {
	return r.seqCtx
}

func (r *Runner) Running() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.running
}

func ResolveOrder(nodes []FlowNode, edges []FlowEdge) ([]string, error) {
	plan, err := resolveExecutionPlan(nodes, edges)
	if err != nil {
		return nil, err
	}
	return plan.order, nil
}

func resolveExecutionPlan(nodes []FlowNode, edges []FlowEdge) (*executionPlan, error) {
	if len(nodes) == 0 {
		return nil, fmt.Errorf("empty node list")
	}

	nodeMap := make(map[string]*FlowNode)
	incoming := make(map[string][]string)
	outgoing := make(map[string][]string)

	for i := range nodes {
		nodeType := normalizeNodeType(nodes[i].Type)
		if nodeType == FlowNodeTypeComment || strings.HasPrefix(nodes[i].ID, "comment") {
			continue
		}
		nodeMap[nodes[i].ID] = &nodes[i]
		incoming[nodes[i].ID] = nil
		outgoing[nodes[i].ID] = nil
	}

	if len(nodeMap) == 0 {
		return nil, fmt.Errorf("empty node list")
	}

	for _, e := range edges {
		source := nodeMap[e.Source]
		target := nodeMap[e.Target]
		if source == nil || target == nil {
			continue
		}
		outgoing[e.Source] = append(outgoing[e.Source], e.Target)
		incoming[e.Target] = append(incoming[e.Target], e.Source)
	}

	observerWaitIDs := make(map[string]bool)
	observerWaitsByRequest := make(map[string][]string)
	requestHasAttachedWait := make(map[string]bool)
	nextNodeByID := make(map[string]string)

	for id, node := range nodeMap {
		nodeType := normalizeNodeType(node.Type)
		switch nodeType {
		case FlowNodeTypeRequest:
			var directRequestTargets []string
			var continuingWaitTargets []string
			var plainWaitTargets []string

			for _, targetID := range outgoing[id] {
				target := nodeMap[targetID]
				if target == nil {
					continue
				}

				switch normalizeNodeType(target.Type) {
				case FlowNodeTypeRequest:
					directRequestTargets = append(directRequestTargets, targetID)
				case FlowNodeTypeWaitResponse:
					waitOutgoing := outgoing[targetID]
					if len(waitOutgoing) > 1 {
						return nil, fmt.Errorf("wait node %s can only continue to one request node", targetID)
					}
					if len(waitOutgoing) == 0 {
						plainWaitTargets = append(plainWaitTargets, targetID)
						continue
					}

					nextID := waitOutgoing[0]
					next := nodeMap[nextID]
					if next == nil || normalizeNodeType(next.Type) != FlowNodeTypeRequest {
						return nil, fmt.Errorf("wait node %s must continue to a request node", targetID)
					}
					continuingWaitTargets = append(continuingWaitTargets, targetID)
				default:
					return nil, fmt.Errorf("request node %s cannot connect to node %s", id, targetID)
				}
			}

			if len(directRequestTargets) > 1 {
				return nil, fmt.Errorf("request node %s can only continue to one request node", id)
			}
			if len(continuingWaitTargets) > 1 {
				return nil, fmt.Errorf("request node %s can only have one continuing wait node", id)
			}
			if len(directRequestTargets) > 0 && len(continuingWaitTargets) > 0 {
				return nil, fmt.Errorf("request node %s has multiple continuation paths", id)
			}

			observerWaitTargets := make([]string, 0, len(plainWaitTargets))
			if len(plainWaitTargets) > 0 {
				if len(directRequestTargets) == 0 && len(continuingWaitTargets) == 0 && len(plainWaitTargets) == 1 {
					nextNodeByID[id] = plainWaitTargets[0]
				} else {
					observerWaitTargets = append(observerWaitTargets, plainWaitTargets...)
				}
			}

			if len(plainWaitTargets) > 0 || len(continuingWaitTargets) > 0 {
				requestHasAttachedWait[id] = true
			}

			if len(observerWaitTargets) > 0 {
				observerWaitsByRequest[id] = append([]string(nil), observerWaitTargets...)
				for _, observerID := range observerWaitTargets {
					observerWaitIDs[observerID] = true
				}
			}

			if len(directRequestTargets) == 1 {
				nextNodeByID[id] = directRequestTargets[0]
			}
			if len(continuingWaitTargets) == 1 {
				nextNodeByID[id] = continuingWaitTargets[0]
			}

		case FlowNodeTypeWaitResponse:
			if len(outgoing[id]) > 1 {
				return nil, fmt.Errorf("wait node %s can only continue to one request node", id)
			}
			if len(incoming[id]) > 1 {
				return nil, fmt.Errorf("wait node %s can only have one parent request node", id)
			}
			if len(incoming[id]) == 1 {
				parent := nodeMap[incoming[id][0]]
				if parent == nil || normalizeNodeType(parent.Type) != FlowNodeTypeRequest {
					return nil, fmt.Errorf("wait node %s must be attached to a request node", id)
				}
			}
			if len(outgoing[id]) == 1 {
				nextID := outgoing[id][0]
				next := nodeMap[nextID]
				if next == nil || normalizeNodeType(next.Type) != FlowNodeTypeRequest {
					return nil, fmt.Errorf("wait node %s must continue to a request node", id)
				}
				nextNodeByID[id] = nextID
			}
		}
	}

	mainNodeIDs := make(map[string]bool)
	inDegree := make(map[string]int)
	for id := range nodeMap {
		if observerWaitIDs[id] {
			continue
		}
		mainNodeIDs[id] = true
		inDegree[id] = 0
	}

	for sourceID, targetID := range nextNodeByID {
		if !mainNodeIDs[sourceID] || !mainNodeIDs[targetID] {
			continue
		}
		inDegree[targetID]++
		if inDegree[targetID] > 1 {
			return nil, fmt.Errorf("node %s has multiple incoming execution paths", targetID)
		}
	}

	var starts []string
	for id, degree := range inDegree {
		if degree == 0 {
			starts = append(starts, id)
		}
	}

	if len(starts) == 0 {
		return nil, fmt.Errorf("no start node found (cycle detected)")
	}
	if len(starts) > 1 {
		return nil, fmt.Errorf("multiple start nodes: %v", starts)
	}

	order := make([]string, 0, len(mainNodeIDs))
	visited := make(map[string]bool)
	current := starts[0]

	for current != "" {
		if visited[current] {
			return nil, fmt.Errorf("cycle detected at node %s", current)
		}
		visited[current] = true
		order = append(order, current)
		current = nextNodeByID[current]
	}

	if len(order) != len(mainNodeIDs) {
		return nil, fmt.Errorf("disconnected graph: resolved %d of %d nodes", len(order), len(mainNodeIDs))
	}

	return &executionPlan{
		order:                  order,
		observerWaitsByRequest: observerWaitsByRequest,
		requestHasAttachedWait: requestHasAttachedWait,
	}, nil
}

func (r *Runner) Execute(ctx context.Context, nodes []FlowNode, edges []FlowEdge, onNode NodeCallback) (err error) {
	plan, err := resolveExecutionPlan(nodes, edges)
	if err != nil {
		return err
	}

	nodeMap := make(map[string]*FlowNode)
	for i := range nodes {
		nodeMap[nodes[i].ID] = &nodes[i]
	}

	r.mu.Lock()
	if r.running {
		r.mu.Unlock()
		return fmt.Errorf("already running")
	}
	r.running = true
	execCtx, cancel := context.WithCancel(ctx)
	r.cancel = cancel
	r.seqCtx.Reset()
	r.resetIncomingPackets()
	r.resetObserverWaits()
	r.setNodeCallback(onNode)
	r.mu.Unlock()

	defer func() {
		r.mu.Lock()
		r.running = false
		r.cancel = nil
		r.mu.Unlock()

		if err != nil {
			r.resetObserverWaits()
			r.setNodeCallback(nil)
			return
		}

		if !r.hasActiveObserverWaits() {
			r.setNodeCallback(nil)
		}
	}()

	for index, nodeID := range plan.order {
		select {
		case <-execCtx.Done():
			err = execCtx.Err()
			return err
		default:
		}

		node := nodeMap[nodeID]
		if node == nil {
			err = fmt.Errorf("node %s not found", nodeID)
			return err
		}

		if normalizeNodeType(node.Type) == FlowNodeTypeRequest {
			for _, observerID := range plan.observerWaitsByRequest[nodeID] {
				observerNode := nodeMap[observerID]
				if observerNode != nil {
					r.activateObserverWait(observerNode)
				}
			}
		}

		var nextNode *FlowNode
		if index+1 < len(plan.order) {
			nextNode = nodeMap[plan.order[index+1]]
		}

		result := r.executeNode(execCtx, node, nextNode, plan.requestHasAttachedWait[nodeID])
		r.emitNodeResult(result)
		if !result.Success {
			err = fmt.Errorf("node %s failed: %s", nodeID, result.Error)
			return err
		}
	}

	return nil
}

func (r *Runner) Stop() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cancel != nil {
		r.cancel()
	}
	r.resetObserverWaits()
	r.setNodeCallback(nil)
}

func (r *Runner) PushIncomingPacket(pkt *codec.Packet) {
	if pkt == nil {
		return
	}

	clone := &codec.Packet{
		Heartbeat:   pkt.Heartbeat,
		ExtCode:     pkt.ExtCode,
		Route:       pkt.Route,
		Seq:         pkt.Seq,
		StringRoute: pkt.StringRoute,
	}
	if len(pkt.Data) > 0 {
		clone.Data = append([]byte(nil), pkt.Data...)
	}

	r.inboxMu.Lock()
	r.inbox = append(r.inbox, clone)
	r.inboxMu.Unlock()

	r.dispatchObserverPacket(clone)

	select {
	case <-r.inboxSignal:
	default:
	}

	select {
	case r.inboxSignal <- struct{}{}:
	default:
	}
}

func (r *Runner) executeNode(ctx context.Context, node *FlowNode, nextNode *FlowNode, hasAttachedWait bool) NodeResult {
	switch normalizeNodeType(node.Type) {
	case FlowNodeTypeWaitResponse:
		return r.executeWaitResponseNode(ctx, node)
	case FlowNodeTypeComment:
		return NodeResult{
			NodeID:   node.ID,
			NodeType: FlowNodeTypeComment,
			Success:  true,
		}
	default:
		waitForResponse := !hasAttachedWait && normalizeNodeType(getNodeType(nextNode)) != FlowNodeTypeWaitResponse
		return r.executeRequestNode(ctx, node, waitForResponse)
	}
}

func (r *Runner) executeRequestNode(ctx context.Context, node *FlowNode, waitForResponse bool) NodeResult {
	start := time.Now()
	result := NodeResult{
		NodeID:     node.ID,
		NodeType:   FlowNodeTypeRequest,
		RequestMsg: node.MessageName,
		Request:    node.Fields,
	}

	if r.encoder == nil {
		result.Error = "message encoder not configured"
		result.Duration = time.Since(start).Milliseconds()
		return result
	}
	if waitForResponse && r.decoder == nil {
		result.Error = "message decoder not configured"
		result.Duration = time.Since(start).Milliseconds()
		return result
	}

	payload, err := r.encoder(node.MessageName, node.Fields)
	if err != nil {
		result.Error = fmt.Sprintf("encode: %v", err)
		result.Duration = time.Since(start).Milliseconds()
		return result
	}

	var (
		seq    uint32
		respCh chan []byte
	)
	if waitForResponse {
		seq, respCh = r.seqCtx.NextSeq()
	} else {
		seq = r.seqCtx.NextSeqValue()
	}

	pkt := &codec.Packet{
		Route:       node.Route,
		Seq:         seq,
		Data:        payload,
		StringRoute: node.StringRoute,
	}

	frame, err := codec.Encode(pkt, r.packetCfg)
	if err != nil {
		result.Error = fmt.Sprintf("frame encode: %v", err)
		result.Duration = time.Since(start).Milliseconds()
		return result
	}

	if r.sendFn == nil {
		result.Error = "send function not configured"
		result.Duration = time.Since(start).Milliseconds()
		return result
	}
	if err := r.sendFn(frame); err != nil {
		result.Error = fmt.Sprintf("send: %v", err)
		result.Duration = time.Since(start).Milliseconds()
		return result
	}

	if !waitForResponse {
		result.Success = true
		result.Duration = time.Since(start).Milliseconds()
		return result
	}

	respData, err := r.seqCtx.WaitResponseContext(ctx, respCh, r.timeout)
	if err != nil {
		result.Error = fmt.Sprintf("wait response: %v", err)
		result.Duration = time.Since(start).Milliseconds()
		return result
	}

	responseName := r.resolveExpectedResponseName(node.Route, node.StringRoute)
	if responseName != "" {
		result.ResponseMsg = responseName
	}

	response, err := r.decoder(responseName, respData)
	if err != nil {
		result.Error = fmt.Sprintf("decode response: %v", err)
		result.Duration = time.Since(start).Milliseconds()
		return result
	}

	result.Success = true
	result.Response = response
	result.Duration = time.Since(start).Milliseconds()
	return result
}

func (r *Runner) executeWaitResponseNode(ctx context.Context, node *FlowNode) NodeResult {
	start := time.Now()
	result := NodeResult{
		NodeID:      node.ID,
		NodeType:    FlowNodeTypeWaitResponse,
		ResponseMsg: node.MessageName,
	}

	if r.decoder == nil {
		result.Error = "message decoder not configured"
		result.Duration = time.Since(start).Milliseconds()
		return result
	}

	pkt, err := r.waitForIncomingPacket(ctx, node)
	if err != nil {
		result.Error = fmt.Sprintf("wait response: %v", err)
		result.Duration = time.Since(start).Milliseconds()
		return result
	}

	return r.decodeWaitPacket(node, pkt, start)
}

func (r *Runner) waitForIncomingPacket(ctx context.Context, node *FlowNode) (*codec.Packet, error) {
	deadline := time.Now().Add(r.timeout)
	for {
		if pkt := r.takeMatchingPacket(node); pkt != nil {
			return pkt, nil
		}

		remaining := time.Until(deadline)
		if remaining <= 0 {
			return nil, fmt.Errorf("response timeout")
		}

		timer := time.NewTimer(remaining)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return nil, ctx.Err()
		case <-timer.C:
			return nil, fmt.Errorf("response timeout")
		case <-r.inboxSignal:
			if !timer.Stop() {
				<-timer.C
			}
		}
	}
}

func (r *Runner) takeMatchingPacket(node *FlowNode) *codec.Packet {
	r.inboxMu.Lock()
	defer r.inboxMu.Unlock()

	for index, pkt := range r.inbox {
		if !r.matchesWaitNode(node, pkt) {
			continue
		}
		r.inbox = append(r.inbox[:index], r.inbox[index+1:]...)
		return pkt
	}
	return nil
}

func (r *Runner) matchesWaitNode(node *FlowNode, pkt *codec.Packet) bool {
	if pkt == nil {
		return false
	}

	hasMatcher := false
	if node.StringRoute != "" {
		hasMatcher = true
		if pkt.StringRoute != node.StringRoute {
			return false
		}
	}
	if node.Route != 0 {
		hasMatcher = true
		if pkt.Route != node.Route {
			return false
		}
	}
	if node.MessageName != "" {
		hasMatcher = true
		if r.resolveIncomingMessageName(pkt.Route, pkt.StringRoute) != node.MessageName {
			return false
		}
	}

	return hasMatcher
}

func (r *Runner) resolveExpectedResponseName(route uint32, stringRoute string) string {
	if stringRoute != "" && r.stringResponseResolver != nil {
		if responseName := r.stringResponseResolver(stringRoute); responseName != "" {
			return responseName
		}
	}
	if r.responseResolver != nil {
		return r.responseResolver(route)
	}
	return ""
}

func (r *Runner) resolveIncomingMessageName(route uint32, stringRoute string) string {
	if r.incomingNameResolver == nil {
		return ""
	}
	return r.incomingNameResolver(route, stringRoute)
}

func (r *Runner) resetIncomingPackets() {
	r.inboxMu.Lock()
	r.inbox = nil
	r.inboxMu.Unlock()

	for {
		select {
		case <-r.inboxSignal:
		default:
			return
		}
	}
}

func (r *Runner) activateObserverWait(node *FlowNode) {
	if node == nil {
		return
	}

	clone := *node
	r.observerMu.Lock()
	r.observerWaits[node.ID] = &clone
	r.observerMu.Unlock()
}

func (r *Runner) dispatchObserverPacket(pkt *codec.Packet) {
	r.observerMu.Lock()
	matched := make([]*FlowNode, 0)
	for id, node := range r.observerWaits {
		if !r.matchesWaitNode(node, pkt) {
			continue
		}
		delete(r.observerWaits, id)
		matched = append(matched, node)
	}
	r.observerMu.Unlock()

	for _, node := range matched {
		r.emitNodeResult(r.decodeWaitPacket(node, pkt, time.Now()))
	}

	if !r.Running() && !r.hasActiveObserverWaits() {
		r.setNodeCallback(nil)
	}
}

func (r *Runner) decodeWaitPacket(node *FlowNode, pkt *codec.Packet, start time.Time) NodeResult {
	result := NodeResult{
		NodeID:      node.ID,
		NodeType:    FlowNodeTypeWaitResponse,
		ResponseMsg: node.MessageName,
	}

	if r.decoder == nil {
		result.Error = "message decoder not configured"
		result.Duration = time.Since(start).Milliseconds()
		return result
	}

	responseName := r.resolveIncomingMessageName(pkt.Route, pkt.StringRoute)
	if responseName == "" {
		responseName = node.MessageName
	}
	if responseName == "" {
		result.Error = "response message name is empty"
		result.Duration = time.Since(start).Milliseconds()
		return result
	}
	result.ResponseMsg = responseName

	response, err := r.decoder(responseName, pkt.Data)
	if err != nil {
		result.Error = fmt.Sprintf("decode response: %v", err)
		result.Duration = time.Since(start).Milliseconds()
		return result
	}

	result.Success = true
	result.Response = response
	result.Duration = time.Since(start).Milliseconds()
	return result
}

func (r *Runner) resetObserverWaits() {
	r.observerMu.Lock()
	r.observerWaits = make(map[string]*FlowNode)
	r.observerMu.Unlock()
}

func (r *Runner) hasActiveObserverWaits() bool {
	r.observerMu.Lock()
	defer r.observerMu.Unlock()
	return len(r.observerWaits) > 0
}

func (r *Runner) setNodeCallback(callback NodeCallback) {
	r.callbackMu.Lock()
	r.nodeCallback = callback
	r.callbackMu.Unlock()
}

func (r *Runner) emitNodeResult(result NodeResult) {
	r.callbackMu.Lock()
	defer r.callbackMu.Unlock()
	if r.nodeCallback != nil {
		r.nodeCallback(result)
	}
}

func normalizeNodeType(nodeType string) string {
	switch nodeType {
	case "", FlowNodeTypeRequest:
		return FlowNodeTypeRequest
	case FlowNodeTypeWaitResponse:
		return FlowNodeTypeWaitResponse
	case FlowNodeTypeComment:
		return FlowNodeTypeComment
	default:
		return FlowNodeTypeRequest
	}
}

func getNodeType(node *FlowNode) string {
	if node == nil {
		return ""
	}
	return node.Type
}
