package cli

import (
	"context"
	"errors"
	"io"
	"sync"
	"testing"
	"time"
)

func TestPoolWorkerNamesKeepASingleWorkerUnchanged(t *testing.T) {
	// A host cap of one must behave exactly as it did before pooling, name
	// included, so existing deployments and their run history are untouched.
	for _, size := range []int{-1, 0, 1} {
		if names := poolWorkerNames("machinist-vm", size); len(names) != 1 || names[0] != "machinist-vm" {
			t.Fatalf("names for size %d = %v", size, names)
		}
	}
	if names := poolWorkerNames("machinist-vm", 3); len(names) != 3 || names[0] != "machinist-vm-1" || names[2] != "machinist-vm-3" {
		t.Fatalf("pooled names = %v", names)
	}
}

func TestSupervisePoolRestartsEveryWorkerUntilCancelled(t *testing.T) {
	var mutex sync.Mutex
	starts := map[string]int{}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()

	start := func(_ context.Context, name string) error {
		mutex.Lock()
		starts[name]++
		total := starts[name]
		mutex.Unlock()
		if total >= 2 {
			// Both workers have been restarted at least once; stop the pool.
			mutex.Lock()
			restarted := starts["host-1"] >= 2 && starts["host-2"] >= 2
			mutex.Unlock()
			if restarted {
				cancel()
			}
		}
		return errors.New("worker exited")
	}

	done := make(chan error, 1)
	go func() { done <- supervisePool(ctx, []string{"host-1", "host-2"}, time.Millisecond, start, io.Discard) }()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("supervise = %v, want nil on cancellation", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("supervisor did not return after cancellation")
	}

	mutex.Lock()
	defer mutex.Unlock()
	if starts["host-1"] < 2 || starts["host-2"] < 2 {
		t.Fatalf("starts = %v, want each worker restarted", starts)
	}
}
