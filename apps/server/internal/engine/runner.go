package engine

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/flow-packet/server/internal/codec"
)

type FlowNode struct {
	ID          string         `json:"id"`
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
	Success     bool           `json:"success"`
	RequestMsg  string         `json:"requestMsg,omitempty"`
	ResponseMsg string         `json:"responseMsg,omitempty"`
	Request     map[string]any `json:"request"`
	Response    map[string]any `json:"response"`
	Error       string         `json:"error,omitempty"`
	Duration    int64          `json:"duration"`
}

type NodeCallback func(result NodeResult)

type MessageEncoder func(messageName string, fields map[string]any) ([]byte, error)

type MessageDecoder func(messageName string, data []byte) (map[string]any, error)

type ResponseNameResolver func(route uint32) string

type StringRouteResponseNameResolver func(route string) string

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
}

func NewRunner(packetCfg codec.PacketConfig) *Runner {
	return &Runner{
		seqCtx:         NewSeqContext(),
		packetCfg:      packetCfg,
		thriftProtocol: "binary",
		timeout:        5 * time.Second,
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
	if len(nodes) == 0 {
		return nil, fmt.Errorf("empty node list")
	}

	nodeMap := make(map[string]*FlowNode)
	inDegree := make(map[string]int)
	outEdge := make(map[string]string)

	for i := range nodes {
		if strings.HasPrefix(nodes[i].ID, "comment") {
			continue
		}
		nodeMap[nodes[i].ID] = &nodes[i]
		inDegree[nodes[i].ID] = 0
	}

	for _, e := range edges {
		outEdge[e.Source] = e.Target
		inDegree[e.Target]++
	}

	var starts []string
	for id, deg := range inDegree {
		if deg == 0 {
			starts = append(starts, id)
		}
	}

	if len(starts) == 0 {
		return nil, fmt.Errorf("no start node found (cycle detected)")
	}
	if len(starts) > 1 {
		return nil, fmt.Errorf("multiple start nodes: %v", starts)
	}

	order := make([]string, 0, len(nodes))
	current := starts[0]
	visited := make(map[string]bool)

	for current != "" {
		if visited[current] {
			return nil, fmt.Errorf("cycle detected at node %s", current)
		}
		visited[current] = true
		order = append(order, current)
		current = outEdge[current]
	}

	if len(order) != len(nodeMap) {
		return nil, fmt.Errorf("disconnected graph: resolved %d of %d nodes", len(order), len(nodeMap))
	}

	return order, nil
}

func (r *Runner) Execute(ctx context.Context, nodes []FlowNode, edges []FlowEdge, onNode NodeCallback) error {
	order, err := ResolveOrder(nodes, edges)
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
	r.mu.Unlock()

	defer func() {
		r.mu.Lock()
		r.running = false
		r.cancel = nil
		r.mu.Unlock()
	}()

	for _, nodeID := range order {
		select {
		case <-execCtx.Done():
			return execCtx.Err()
		default:
		}

		node := nodeMap[nodeID]
		result := r.executeNode(node)
		if onNode != nil {
			onNode(result)
		}
		if !result.Success {
			return fmt.Errorf("node %s failed: %s", nodeID, result.Error)
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
}

func (r *Runner) executeNode(node *FlowNode) NodeResult {
	start := time.Now()

	result := NodeResult{
		NodeID:     node.ID,
		RequestMsg: node.MessageName,
		Request:    node.Fields,
	}

	if r.encoder == nil {
		result.Error = "message encoder not configured"
		result.Duration = time.Since(start).Milliseconds()
		return result
	}
	if r.decoder == nil {
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

	seq, respCh := r.seqCtx.NextSeq()

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

	respData, err := r.seqCtx.WaitResponse(respCh, r.timeout)
	if err != nil {
		result.Error = fmt.Sprintf("wait response: %v", err)
		result.Duration = time.Since(start).Milliseconds()
		return result
	}

	var responseName string
	if node.StringRoute != "" && r.stringResponseResolver != nil {
		responseName = r.stringResponseResolver(node.StringRoute)
	} else if r.responseResolver != nil {
		responseName = r.responseResolver(node.Route)
	}
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
