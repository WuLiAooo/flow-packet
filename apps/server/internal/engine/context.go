package engine

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// SeqContext tracks transport sequences and pending response waiters.
type SeqContext struct {
	mu      sync.Mutex
	counter uint32
	pending map[uint32]chan []byte
}

// NewSeqContext creates a sequence context with a zero-valued counter.
func NewSeqContext() *SeqContext {
	return NewSeqContextWithCounter(0)
}

// NewSeqContextWithCounter creates a sequence context with an initial counter value.
func NewSeqContextWithCounter(counter uint32) *SeqContext {
	return &SeqContext{
		counter: counter,
		pending: make(map[uint32]chan []byte),
	}
}

// NextSeq allocates the next sequence and tracks its response channel.
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

// Resolve delivers a response to a specific waiting sequence.
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

// ResolveFirst falls back to the earliest pending waiter when the sequence is missing.
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

// WaitResponse waits for a response until timeout.
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

// ClearPending removes all pending waiters while preserving the current counter.
func (c *SeqContext) ClearPending() {
	c.mu.Lock()
	defer c.mu.Unlock()
	for seq, ch := range c.pending {
		close(ch)
		delete(c.pending, seq)
	}
}

// SetCounter updates the internal sequence counter.
func (c *SeqContext) SetCounter(counter uint32) {
	c.mu.Lock()
	c.counter = counter
	c.mu.Unlock()
}

// ResetTo clears pending waiters and resets the counter to the provided value.
func (c *SeqContext) ResetTo(counter uint32) {
	c.mu.Lock()
	c.counter = counter
	for seq, ch := range c.pending {
		close(ch)
		delete(c.pending, seq)
	}
	c.mu.Unlock()
}

// Reset clears all waiters and resets the counter to zero.
func (c *SeqContext) Reset() {
	c.ResetTo(0)
}
