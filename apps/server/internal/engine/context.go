package engine

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// SeqContext seq ��������Ӧƥ��
type SeqContext struct {
	mu      sync.Mutex
	counter uint32
	pending map[uint32]chan []byte
}

// NewSeqContext ���� seq ������
func NewSeqContext() *SeqContext {
	return &SeqContext{
		pending: make(map[uint32]chan []byte),
	}
}

// NextSeq ������һ�� seq ��ע��ȴ�ͨ��
func (c *SeqContext) NextSeq() (uint32, chan []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.counter++
	seq := c.counter
	ch := make(chan []byte, 1)
	c.pending[seq] = ch
	return seq, ch
}

// NextSeqValue allocates the next sequence without waiting for a response.
func (c *SeqContext) NextSeqValue() uint32 {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.counter++
	return c.counter
}

// Resolve �յ���Ӧ��, ͨ�� seq ƥ�䵽�ȴ���
func (c *SeqContext) Resolve(seq uint32, data []byte) bool {
	c.mu.Lock()
	ch, ok := c.pending[seq]
	if ok {
		delete(c.pending, seq)
	}
	c.mu.Unlock()

	if !ok {
		return false
	}

	ch <- data
	return true
}

// ResolveFirst �� seq �޷���ȷƥ��ʱ, ��������ĵȴ�����
// �����ڷ���˲��ش� seq ��Э��(��Ӧ seq=0)
func (c *SeqContext) ResolveFirst(data []byte) bool {
	c.mu.Lock()
	var minSeq uint32
	var minCh chan []byte
	for seq, ch := range c.pending {
		if minCh == nil || seq < minSeq {
			minSeq = seq
			minCh = ch
		}
	}
	if minCh != nil {
		delete(c.pending, minSeq)
	}
	c.mu.Unlock()

	if minCh == nil {
		return false
	}

	minCh <- data
	return true
}

// WaitResponse �ȴ�ָ�� seq ����Ӧ, ��ʱ���ش���
func (c *SeqContext) WaitResponse(ch chan []byte, timeout time.Duration) ([]byte, error) {
	return c.WaitResponseContext(context.Background(), ch, timeout)
}

// WaitResponseContext waits for a response until timeout or cancellation.
func (c *SeqContext) WaitResponseContext(ctx context.Context, ch chan []byte, timeout time.Duration) ([]byte, error) {
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case data := <-ch:
		return data, nil
	case <-timer.C:
		return nil, fmt.Errorf("response timeout")
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// Reset ����������
func (c *SeqContext) Reset() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.counter = 0
	for seq, ch := range c.pending {
		close(ch)
		delete(c.pending, seq)
	}
}
