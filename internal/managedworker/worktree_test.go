package managedworker

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/owainlewis/machinist/internal/config"
)

func TestWorkerWorktreeIsPerWorkerDetachedAndReused(t *testing.T) {
	checkout := initTestRepository(t)
	root := t.TempDir()

	first, err := prepareWorkerWorktree(t.Context(), checkout, root, "host-1", "machinist")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(first, root) {
		t.Fatalf("worktree %q is not inside the worker's data directory %q", first, root)
	}
	if _, err := os.Stat(filepath.Join(first, "README.md")); err != nil {
		t.Fatalf("worktree is missing the repository contents: %v", err)
	}

	// Detached, because git refuses to check out one branch in two worktrees
	// and every worker shares this repository.
	if output, err := runGit(t, first, "symbolic-ref", "-q", "HEAD"); err == nil {
		t.Fatalf("worktree HEAD is attached to %q", output)
	}
	if head, _ := runGit(t, first, "rev-parse", "HEAD"); head != mustGit(t, checkout, "rev-parse", "HEAD") {
		t.Fatalf("worktree head = %q", head)
	}

	// Reused rather than recreated, so the checkout cost is paid once.
	reused, err := prepareWorkerWorktree(t.Context(), checkout, root, "host-1", "machinist")
	if err != nil || reused != first {
		t.Fatalf("reused = %q, %v, want %q", reused, err, first)
	}

	other, err := prepareWorkerWorktree(t.Context(), checkout, root, "host-2", "machinist")
	if err != nil || other == first {
		t.Fatalf("second worker = %q, %v, want a distinct worktree", other, err)
	}
}

func initTestRepository(t *testing.T) string {
	t.Helper()
	directory := t.TempDir()
	mustGit(t, directory, "init", "--initial-branch=main")
	mustGit(t, directory, "config", "user.email", "test@example.com")
	mustGit(t, directory, "config", "user.name", "Test")
	if err := os.WriteFile(filepath.Join(directory, "README.md"), []byte("machinist\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	mustGit(t, directory, "add", "README.md")
	mustGit(t, directory, "commit", "-m", "initial")
	return directory
}

func runGit(t *testing.T, directory string, args ...string) (string, error) {
	t.Helper()
	command := exec.Command("git", append([]string{"-C", directory}, args...)...)
	output, err := command.Output()
	return strings.TrimSpace(string(output)), err
}

func mustGit(t *testing.T, directory string, args ...string) string {
	t.Helper()
	output, err := runGit(t, directory, args...)
	if err != nil {
		t.Fatalf("git %v in %s: %v", args, directory, err)
	}
	return output
}

func TestWorkerWorktreeFallsBackToTheCheckoutBeforeTheFirstCommit(t *testing.T) {
	// A repository with no commits has no HEAD to detach from, and nothing to
	// contend over either, so the checkout itself is the honest answer.
	checkout := t.TempDir()
	mustGit(t, checkout, "init", "--initial-branch=main")

	directory, err := prepareWorkerWorktree(t.Context(), checkout, t.TempDir(), "host-1", "machinist")
	if err != nil {
		t.Fatal(err)
	}
	if directory != checkout {
		t.Fatalf("directory = %q, want the checkout %q", directory, checkout)
	}
}

func TestEnsureCheckoutPrefersConfiguredPathThenClonesOnce(t *testing.T) {
	source := initTestRepository(t)
	data := t.TempDir()
	configured := config.Worker{
		DataDirectory: data,
		Repositories:  map[string]config.Repository{"machinist": {Path: source}},
	}

	// An explicitly configured checkout always wins, so a hand-managed working
	// copy is never shadowed by a clone.
	path, err := ensureCheckout(t.Context(), configured, "machinist", source)
	if err != nil || path != source {
		t.Fatalf("configured checkout = %q, %v, want %q", path, err, source)
	}

	// An unregistered repository is materialised from its remote on first use.
	empty := config.Worker{DataDirectory: data}
	cloned, err := ensureCheckout(t.Context(), empty, "machinist", source)
	if err != nil {
		t.Fatal(err)
	}
	if cloned == source || !strings.HasPrefix(cloned, data) {
		t.Fatalf("cloned checkout = %q, want a fresh checkout under %q", cloned, data)
	}
	if _, err := os.Stat(filepath.Join(cloned, "README.md")); err != nil {
		t.Fatalf("clone is missing the repository contents: %v", err)
	}

	reused, err := ensureCheckout(t.Context(), empty, "machinist", source)
	if err != nil || reused != cloned {
		t.Fatalf("reused = %q, %v, want %q", reused, err, cloned)
	}

	if _, err := ensureCheckout(t.Context(), empty, "unknown", ""); err == nil {
		t.Fatal("expected a repository with no checkout and no remote to fail")
	}
}

func TestGitHubCloneURLBuildsAnHTTPSRemote(t *testing.T) {
	if got := githubCloneURL("anggel7x/tac_restaurant"); got != "https://github.com/anggel7x/tac_restaurant.git" {
		t.Fatalf("clone url = %q", got)
	}
	if got := githubCloneURL(""); got != "" {
		t.Fatalf("empty slug url = %q", got)
	}
}
