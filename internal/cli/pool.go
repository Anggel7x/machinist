package cli

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"sync"
	"time"
)

// poolRestartBackoff is how long a crashed worker waits before restarting, so
// a worker that fails immediately cannot spin.
const poolRestartBackoff = 5 * time.Second

// poolWorkerNames names the workers one host runs. A cap of one keeps the
// configured name exactly as it is, so a host that was running a single worker
// before pooling keeps its identity, its lease history and its run records.
func poolWorkerNames(base string, size int) []string {
	if size <= 1 {
		return []string{base}
	}
	names := make([]string, 0, size)
	for index := 1; index <= size; index++ {
		names = append(names, base+"-"+strconv.Itoa(index))
	}
	return names
}

// supervisePool keeps one child process alive per worker name until the
// context is cancelled.
//
// Workers are processes rather than goroutines in one process for two reasons:
// the control plane's one-lease-per-instance invariant stays exactly as it is,
// and a wedged coding agent takes down one worker instead of the whole host.
func supervisePool(ctx context.Context, names []string, backoff time.Duration, start func(context.Context, string) error, stderr io.Writer) error {
	if backoff <= 0 {
		backoff = poolRestartBackoff
	}
	var workers sync.WaitGroup
	for _, name := range names {
		workers.Add(1)
		go func(name string) {
			defer workers.Done()
			for ctx.Err() == nil {
				if err := start(ctx, name); err != nil && ctx.Err() == nil {
					fmt.Fprintf(stderr, "machinist: worker %s exited: %v\n", name, err)
				}
				if !sleepContext(ctx, backoff) {
					return
				}
			}
		}(name)
	}
	workers.Wait()
	return nil
}

func sleepContext(ctx context.Context, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

// startPoolWorker re-executes this binary as one worker of the pool. The child
// is the same `worker start` command with its name fixed, which is why there
// is only ever one way to run a worker host.
func startPoolWorker(ctx context.Context, configPath, name string, stdout, stderr io.Writer) error {
	executable, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate machinist executable: %w", err)
	}
	args := []string{"worker", "start", "--worker-name", name}
	if configPath != "" {
		args = append(args, "--config", configPath)
	}
	command := exec.CommandContext(ctx, executable, args...)
	command.Stdout = stdout
	command.Stderr = stderr
	return command.Run()
}
