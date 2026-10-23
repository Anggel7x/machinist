package managedworker

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/owainlewis/machinist/internal/config"
)

// prepareWorkerWorktree returns the directory a run should execute in, creating
// it on first use.
//
// Every run used to start in the repository's shared checkout, which was safe
// only because the prompts told each agent to build itself a worktree. Once a
// host runs several workers against one repository that stops being a
// convention and becomes a shared git index. Giving each worker its own
// worktree removes the contention structurally, and costs almost nothing on
// disk because worktrees share the repository's object store.
//
// The worktree is detached: git refuses to check out the same branch in two
// worktrees, and every worker here starts from the same head.
func prepareWorkerWorktree(ctx context.Context, checkout, dataDirectory, worker, repository string) (string, error) {
	if strings.TrimSpace(checkout) == "" {
		return "", fmt.Errorf("repository %q has no checkout", repository)
	}
	if _, err := runGitCommand(ctx, checkout, "rev-parse", "--verify", "HEAD"); err != nil {
		// No commits yet, so there is no head to detach and no history to
		// contend over. Run in the checkout, exactly as before pooling.
		return checkout, nil
	}
	worktree := filepath.Join(dataDirectory, "worktrees", sanitizePathSegment(worker), sanitizePathSegment(repository))
	if isGitWorktree(ctx, worktree) {
		if err := resetWorkerWorktree(ctx, checkout, worktree); err != nil {
			return "", err
		}
		return worktree, nil
	}
	if entries, err := os.ReadDir(worktree); err == nil && len(entries) > 0 {
		// A directory that is not a worktree is someone else's data; refuse to
		// touch it rather than deleting whatever is there.
		return "", fmt.Errorf("worker worktree %q exists but is not a Git worktree", worktree)
	}
	if err := os.MkdirAll(filepath.Dir(worktree), 0o755); err != nil {
		return "", fmt.Errorf("create worker worktree directory: %w", err)
	}
	// Prune first so a worktree deleted from disk cannot block re-registration.
	_, _ = runGitCommand(ctx, checkout, "worktree", "prune")
	if output, err := runGitCommand(ctx, checkout, "worktree", "add", "--detach", worktree, "HEAD"); err != nil {
		return "", fmt.Errorf("create worker worktree %q: %w: %s", worktree, err, output)
	}
	return worktree, nil
}

// resetWorkerWorktree returns a reused worktree to the checkout's current head
// and removes whatever the last run left behind. Without this, run N+1 starts
// on run N's commits and dirty files — the worktree is a starting point for
// work, not a place work is kept, and agents create their own worktrees for
// anything they intend to keep.
//
// Ignored files survive, so dependency and build caches are not thrown away on
// every run.
func resetWorkerWorktree(ctx context.Context, checkout, worktree string) error {
	head, err := runGitCommand(ctx, checkout, "rev-parse", "HEAD")
	if err != nil {
		return fmt.Errorf("read checkout head for %q: %w: %s", worktree, err, head)
	}
	if output, err := runGitCommand(ctx, worktree, "reset", "--hard", head); err != nil {
		return fmt.Errorf("reset worker worktree %q: %w: %s", worktree, err, output)
	}
	if output, err := runGitCommand(ctx, worktree, "clean", "-fd"); err != nil {
		return fmt.Errorf("clean worker worktree %q: %w: %s", worktree, err, output)
	}
	return nil
}

func isGitWorktree(ctx context.Context, directory string) bool {
	if _, err := os.Stat(directory); err != nil {
		return false
	}
	_, err := runGitCommand(ctx, directory, "rev-parse", "--git-dir")
	return err == nil
}

func runGitCommand(ctx context.Context, directory string, args ...string) (string, error) {
	command := exec.CommandContext(ctx, "git", append([]string{"-C", directory}, args...)...)
	output, err := command.CombinedOutput()
	return strings.TrimSpace(string(output)), err
}

// sanitizePathSegment keeps a worker or repository name usable as one path
// segment. Both are validated upstream, so this is a boundary guard rather
// than a parser.
func sanitizePathSegment(value string) string {
	value = strings.TrimSpace(value)
	replaced := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_', r == '.':
			return r
		default:
			return '-'
		}
	}, value)
	replaced = strings.Trim(replaced, ".-")
	if replaced == "" {
		return "worker"
	}
	return replaced
}

// ensureCheckout returns the base checkout for one repository, cloning it if
// this host has never seen it.
//
// An explicit path in worker.toml always wins: a hand-managed working copy
// must never be shadowed by a clone. Otherwise the host materialises the
// repository itself, which is what makes registering a repository one action
// centrally rather than an edit to every worker.toml — and the only thing that
// can work when the control plane and the worker are different machines.
func ensureCheckout(ctx context.Context, worker config.Worker, repository, remote string) (string, error) {
	if path, err := worker.ResolveRepository(repository); err == nil {
		return path, nil
	}
	if strings.TrimSpace(remote) == "" {
		return "", fmt.Errorf("repository %q is not configured on this worker and has no remote to clone", repository)
	}
	target := filepath.Join(worker.DataDirectory, "checkouts", sanitizePathSegment(repository))
	if isGitWorktree(ctx, target) {
		return target, nil
	}
	if entries, err := os.ReadDir(target); err == nil && len(entries) > 0 {
		return "", fmt.Errorf("checkout %q exists but is not a Git repository", target)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return "", fmt.Errorf("create checkout directory: %w", err)
	}
	command := exec.CommandContext(ctx, "git", "clone", remote, target)
	if output, err := command.CombinedOutput(); err != nil {
		return "", fmt.Errorf("clone %s into %q: %w: %s", remote, target, err, strings.TrimSpace(string(output)))
	}
	return target, nil
}

func githubCloneURL(slug string) string {
	slug = strings.TrimSpace(slug)
	if slug == "" {
		return ""
	}
	return "https://github.com/" + slug + ".git"
}
