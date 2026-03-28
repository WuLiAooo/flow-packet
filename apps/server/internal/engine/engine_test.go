package engine

import (
	"context"
	"testing"
	"time"

	"github.com/flow-packet/server/internal/codec"
)

func TestResolveOrderLinearChain(t *testing.T) {
	nodes := []FlowNode{
		{ID: "a"},
		{ID: "b"},
		{ID: "c"},
	}
	edges := []FlowEdge{
		{Source: "a", Target: "b"},
		{Source: "b", Target: "c"},
	}

	order, err := ResolveOrder(nodes, edges)
	if err != nil {
		t.Fatalf("ResolveOrder error: %v", err)
	}

	if len(order) != 3 {
		t.Fatalf("order len = %d, want 3", len(order))
	}
	if order[0] != "a" || order[1] != "b" || order[2] != "c" {
		t.Fatalf("order = %v, want [a b c]", order)
	}
}

func TestResolveOrderSingleNode(t *testing.T) {
	nodes := []FlowNode{{ID: "x"}}
	edges := []FlowEdge{}

	order, err := ResolveOrder(nodes, edges)
	if err != nil {
		t.Fatalf("ResolveOrder error: %v", err)
	}

	if len(order) != 1 || order[0] != "x" {
		t.Fatalf("order = %v, want [x]", order)
	}
}

func TestResolveOrderIgnoresCommentNodes(t *testing.T) {
	nodes := []FlowNode{
		{ID: "a", Type: FlowNodeTypeRequest},
		{ID: "comment_1", Type: FlowNodeTypeComment},
		{ID: "b", Type: FlowNodeTypeWaitResponse},
	}
	edges := []FlowEdge{{Source: "a", Target: "b"}}

	order, err := ResolveOrder(nodes, edges)
	if err != nil {
		t.Fatalf("ResolveOrder error: %v", err)
	}
	if len(order) != 2 {
		t.Fatalf("order len = %d, want 2", len(order))
	}
}

func TestResolveOrderMultipleStartsError(t *testing.T) {
	nodes := []FlowNode{
		{ID: "a"},
		{ID: "b"},
		{ID: "c"},
	}
	edges := []FlowEdge{
		{Source: "a", Target: "c"},
	}

	_, err := ResolveOrder(nodes, edges)
	if err == nil {
		t.Fatal("expected error for multiple start nodes")
	}
}

func TestResolveOrderEmptyNodes(t *testing.T) {
	_, err := ResolveOrder([]FlowNode{}, []FlowEdge{})
	if err == nil {
		t.Fatal("expected error for empty nodes")
	}
}

func TestSeqContextNextAndResolve(t *testing.T) {
	ctx := NewSeqContext()

	seq1, ch1 := ctx.NextSeq()
	if seq1 != 1 {
		t.Fatalf("seq1 = %d, want 1", seq1)
	}

	seq2, ch2 := ctx.NextSeq()
	if seq2 != 2 {
		t.Fatalf("seq2 = %d, want 2", seq2)
	}

	if !ctx.Resolve(2, []byte("resp2")) {
		t.Fatal("Resolve seq 2 returned false")
	}
	if !ctx.Resolve(1, []byte("resp1")) {
		t.Fatal("Resolve seq 1 returned false")
	}

	data1 := <-ch1
	if string(data1) != "resp1" {
		t.Fatalf("ch1 data = %q, want %q", data1, "resp1")
	}

	data2 := <-ch2
	if string(data2) != "resp2" {
		t.Fatalf("ch2 data = %q, want %q", data2, "resp2")
	}
}

func TestSeqContextNextSeqValue(t *testing.T) {
	ctx := NewSeqContext()
	if seq := ctx.NextSeqValue(); seq != 1 {
		t.Fatalf("seq = %d, want 1", seq)
	}
	if seq, _ := ctx.NextSeq(); seq != 2 {
		t.Fatalf("seq = %d, want 2", seq)
	}
}

func TestSeqContextResolveUnknown(t *testing.T) {
	ctx := NewSeqContext()
	if ctx.Resolve(999, []byte("data")) {
		t.Fatal("Resolve for unknown seq should return false")
	}
}

func TestSeqContextWaitTimeout(t *testing.T) {
	ctx := NewSeqContext()
	_, ch := ctx.NextSeq()

	_, err := ctx.WaitResponse(ch, 50*time.Millisecond)
	if err == nil {
		t.Fatal("expected timeout error")
	}
}

func TestSeqContextWaitSuccess(t *testing.T) {
	ctx := NewSeqContext()
	seq, ch := ctx.NextSeq()

	go func() {
		time.Sleep(10 * time.Millisecond)
		ctx.Resolve(seq, []byte("response data"))
	}()

	data, err := ctx.WaitResponse(ch, 2*time.Second)
	if err != nil {
		t.Fatalf("WaitResponse error: %v", err)
	}
	if string(data) != "response data" {
		t.Fatalf("data = %q, want %q", data, "response data")
	}
}

func TestSeqContextWaitCanceled(t *testing.T) {
	ctx := NewSeqContext()
	_, ch := ctx.NextSeq()
	cancelCtx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := ctx.WaitResponseContext(cancelCtx, ch, time.Second)
	if err == nil {
		t.Fatal("expected cancellation error")
	}
}

func TestSeqContextReset(t *testing.T) {
	ctx := NewSeqContext()
	ctx.NextSeq()
	ctx.NextSeq()

	ctx.Reset()

	seq, _ := ctx.NextSeq()
	if seq != 1 {
		t.Fatalf("seq after reset = %d, want 1", seq)
	}
}

func TestRunnerExplicitWaitNodeConsumesBufferedResponse(t *testing.T) {
	runner := NewRunner(defaultPacketConfig())
	runner.SetMessageEncoder(func(messageName string, fields map[string]any) ([]byte, error) {
		return []byte(messageName), nil
	})
	runner.SetMessageDecoder(func(messageName string, data []byte) (map[string]any, error) {
		return map[string]any{
			"message": messageName,
			"body":    string(data),
		}, nil
	})
	runner.SetIncomingMessageNameResolver(func(route uint32, stringRoute string) string {
		if route == 2001 {
			return "game.GcLogin"
		}
		return ""
	})
	runner.SetSendFunc(func(data []byte) error {
		runner.PushIncomingPacket(&codec.Packet{Route: 2001, Data: []byte("ok")})
		return nil
	})

	nodes := []FlowNode{
		{ID: "cg", Type: FlowNodeTypeRequest, MessageName: "game.CgLogin", Route: 1001, Fields: map[string]any{"user": "alice"}},
		{ID: "gc", Type: FlowNodeTypeWaitResponse, MessageName: "game.GcLogin", Route: 2001},
	}
	edges := []FlowEdge{{Source: "cg", Target: "gc"}}

	var results []NodeResult
	err := runner.Execute(context.Background(), nodes, edges, func(result NodeResult) {
		results = append(results, result)
	})
	if err != nil {
		t.Fatalf("Execute error: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("results len = %d, want 2", len(results))
	}
	if !results[0].Success || results[0].ResponseMsg != "" {
		t.Fatalf("request result = %+v", results[0])
	}
	if !results[1].Success {
		t.Fatalf("wait result = %+v", results[1])
	}
	if results[1].ResponseMsg != "game.GcLogin" {
		t.Fatalf("response msg = %q, want %q", results[1].ResponseMsg, "game.GcLogin")
	}
	if results[1].Response["body"] != "ok" {
		t.Fatalf("response body = %#v, want ok", results[1].Response["body"])
	}
}

func TestRunnerLegacyRequestStillWaitsForMappedResponse(t *testing.T) {
	runner := NewRunner(defaultPacketConfig())
	runner.SetMessageEncoder(func(messageName string, fields map[string]any) ([]byte, error) {
		return []byte("request"), nil
	})
	runner.SetMessageDecoder(func(messageName string, data []byte) (map[string]any, error) {
		return map[string]any{"message": messageName, "body": string(data)}, nil
	})
	runner.SetResponseNameResolver(func(route uint32) string {
		if route == 1001 {
			return "game.GcLogin"
		}
		return ""
	})
	runner.SetSendFunc(func(data []byte) error {
		pkt, err := codec.DecodeBytes(data, defaultPacketConfig())
		if err != nil {
			return err
		}
		go func(seq uint32) {
			time.Sleep(10 * time.Millisecond)
			runner.SeqCtx().Resolve(seq, []byte("ok"))
		}(pkt.Seq)
		return nil
	})

	nodes := []FlowNode{{ID: "cg", Type: FlowNodeTypeRequest, MessageName: "game.CgLogin", Route: 1001}}
	if err := runner.Execute(context.Background(), nodes, nil, nil); err != nil {
		t.Fatalf("Execute error: %v", err)
	}
}

func TestRunnerStopCancelsExecution(t *testing.T) {
	runner := NewRunner(defaultPacketConfig())
	runner.SetMessageEncoder(func(messageName string, fields map[string]any) ([]byte, error) {
		return []byte("request"), nil
	})
	runner.SetMessageDecoder(func(messageName string, data []byte) (map[string]any, error) {
		return map[string]any{"body": string(data)}, nil
	})
	runner.SetSendFunc(func(data []byte) error {
		return nil
	})

	nodes := []FlowNode{{ID: "gc", Type: FlowNodeTypeWaitResponse, MessageName: "game.GcLogin", Route: 1001}}

	done := make(chan error, 1)
	go func() {
		err := runner.Execute(context.Background(), nodes, nil, nil)
		done <- err
	}()

	time.Sleep(50 * time.Millisecond)
	runner.Stop()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected execution to stop with error")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for execution to stop")
	}
}

func defaultPacketConfig() codec.PacketConfig {
	return codec.PacketConfig{RouteBytes: 2, SeqBytes: 2}
}

func TestResolveOrderAllowsObserverWaitNodes(t *testing.T) {
	nodes := []FlowNode{
		{ID: "cg1", Type: FlowNodeTypeRequest},
		{ID: "gc_observe", Type: FlowNodeTypeWaitResponse},
		{ID: "gc_main", Type: FlowNodeTypeWaitResponse},
		{ID: "cg2", Type: FlowNodeTypeRequest},
	}
	edges := []FlowEdge{
		{Source: "cg1", Target: "gc_observe"},
		{Source: "cg1", Target: "gc_main"},
		{Source: "gc_main", Target: "cg2"},
	}

	order, err := ResolveOrder(nodes, edges)
	if err != nil {
		t.Fatalf("ResolveOrder error: %v", err)
	}

	want := []string{"cg1", "gc_main", "cg2"}
	if len(order) != len(want) {
		t.Fatalf("order len = %d, want %d", len(order), len(want))
	}
	for i := range want {
		if order[i] != want[i] {
			t.Fatalf("order[%d] = %q, want %q", i, order[i], want[i])
		}
	}
}

func TestRunnerObserverWaitReceivesLatePacket(t *testing.T) {
	runner := NewRunner(defaultPacketConfig())
	runner.SetMessageEncoder(func(messageName string, fields map[string]any) ([]byte, error) {
		return []byte(messageName), nil
	})
	runner.SetMessageDecoder(func(messageName string, data []byte) (map[string]any, error) {
		return map[string]any{
			"message": messageName,
			"body":    string(data),
		}, nil
	})
	runner.SetIncomingMessageNameResolver(func(route uint32, stringRoute string) string {
		switch route {
		case 2001:
			return "game.GcLogin"
		case 2002:
			return "game.GcNotice"
		default:
			return ""
		}
	})
	callCount := 0
	runner.SetSendFunc(func(data []byte) error {
		callCount++
		switch callCount {
		case 1:
			go func() {
				time.Sleep(10 * time.Millisecond)
				runner.PushIncomingPacket(&codec.Packet{Route: 2001, Data: []byte("main")})
			}()
			go func() {
				time.Sleep(25 * time.Millisecond)
				runner.PushIncomingPacket(&codec.Packet{Route: 2002, Data: []byte("observe")})
			}()
		case 2:
			pkt, err := codec.DecodeBytes(data, defaultPacketConfig())
			if err != nil {
				return err
			}
			go func(seq uint32) {
				time.Sleep(60 * time.Millisecond)
				runner.SeqCtx().Resolve(seq, []byte("done"))
			}(pkt.Seq)
		}
		return nil
	})

	nodes := []FlowNode{
		{ID: "cg1", Type: FlowNodeTypeRequest, MessageName: "game.CgLogin", Route: 1001},
		{ID: "gc_observe", Type: FlowNodeTypeWaitResponse, MessageName: "game.GcNotice", Route: 2002},
		{ID: "gc_main", Type: FlowNodeTypeWaitResponse, MessageName: "game.GcLogin", Route: 2001},
		{ID: "cg2", Type: FlowNodeTypeRequest, MessageName: "game.CgEnter", Route: 1002},
	}
	edges := []FlowEdge{
		{Source: "cg1", Target: "gc_observe"},
		{Source: "cg1", Target: "gc_main"},
		{Source: "gc_main", Target: "cg2"},
	}

	resultsCh := make(chan NodeResult, 8)
	err := runner.Execute(context.Background(), nodes, edges, func(result NodeResult) {
		resultsCh <- result
	})
	if err != nil {
		t.Fatalf("Execute error: %v", err)
	}

	deadline := time.After(300 * time.Millisecond)
	results := make(map[string]NodeResult)
	for len(results) < 4 {
		select {
		case result := <-resultsCh:
			results[result.NodeID] = result
		case <-deadline:
			t.Fatalf("timed out waiting for observer results, got %d", len(results))
		}
	}

	if !results["cg1"].Success {
		t.Fatalf("cg1 result = %+v", results["cg1"])
	}
	if !results["gc_main"].Success || results["gc_main"].Response["body"] != "main" {
		t.Fatalf("gc_main result = %+v", results["gc_main"])
	}
	if !results["gc_observe"].Success || results["gc_observe"].Response["body"] != "observe" {
		t.Fatalf("gc_observe result = %+v", results["gc_observe"])
	}
	if !results["cg2"].Success || results["cg2"].Response["body"] != "done" {
		t.Fatalf("cg2 result = %+v", results["cg2"])
	}
}
