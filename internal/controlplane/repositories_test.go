package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/owainlewis/machinist/internal/config"
	"github.com/owainlewis/machinist/internal/protocol"
)

func TestServerRegistersRepositoryFromTheBrowser(t *testing.T) {
	server, webServer := newTestHTTPServer(t)
	defer webServer.Close()
	status := getStatus(t, webServer.URL)
	if len(status.RegisteredRepositories) != 0 {
		t.Fatalf("registered = %#v", status.RegisteredRepositories)
	}
	headers := map[string]string{"Origin": webServer.URL, "X-Machinist-CSRF": status.CSRFToken}

	forged := postJSON(t, webServer.URL+"/api/v1/repositories", map[string]any{"slug": "acme/web"}, map[string]string{"Origin": webServer.URL})
	forged.Body.Close()
	if forged.StatusCode != http.StatusForbidden {
		t.Fatalf("registration without CSRF status = %d", forged.StatusCode)
	}

	created := postJSON(t, webServer.URL+"/api/v1/repositories", map[string]any{"slug": "acme/web_app", "parallel": 2}, headers)
	var registered struct {
		config.RepositoryRegistration
		Error string `json:"error"`
	}
	if err := json.NewDecoder(created.Body).Decode(&registered); err != nil {
		t.Fatal(err)
	}
	created.Body.Close()
	if created.StatusCode != http.StatusCreated || registered.RepositoryRegistration != (config.RepositoryRegistration{Name: "web-app", Slug: "acme/web_app", Parallel: 2}) {
		t.Fatalf("status = %d, registered = %#v", created.StatusCode, registered)
	}
	body, err := os.ReadFile(server.definitionPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "[repositories.web-app]\nslug = \"acme/web_app\"\nparallel = 2\n") {
		t.Fatalf("config.toml:\n%s", body)
	}
	status = getStatus(t, webServer.URL)
	if len(status.RegisteredRepositories) != 1 || status.RegisteredRepositories[0] != registered.RepositoryRegistration {
		t.Fatalf("registered = %#v", status.RegisteredRepositories)
	}
	if server.dispatchLimits().RepositoryCeilings["web-app"] != 2 {
		t.Fatalf("limits = %#v", server.dispatchLimits())
	}

	for _, test := range []struct {
		body map[string]any
		want int
	}{
		{body: map[string]any{"slug": "ACME/web_app"}, want: http.StatusConflict},
		{body: map[string]any{"slug": "acme/other", "name": "web-app"}, want: http.StatusConflict},
		{body: map[string]any{"slug": "not-a-slug"}, want: http.StatusBadRequest},
		{body: map[string]any{"slug": "acme/other", "path": "/tmp"}, want: http.StatusBadRequest},
	} {
		response := postJSON(t, webServer.URL+"/api/v1/repositories", test.body, headers)
		response.Body.Close()
		if response.StatusCode != test.want {
			t.Fatalf("%v status = %d, want %d", test.body, response.StatusCode, test.want)
		}
	}

	// A registered repository accepts work before any worker has advertised it.
	job := postJSON(t, webServer.URL+"/api/v1/jobs", map[string]string{"prompt": "Ship it", "repository": "web-app", "command": "plan"}, headers)
	job.Body.Close()
	if job.StatusCode != http.StatusCreated {
		t.Fatalf("job status = %d", job.StatusCode)
	}

	listed := pollRun(t, webServer.URL, protocol.PollRequest{InstanceID: "listed", Name: "listed", Executors: []string{"test"}, Repositories: []string{"machinist"}})
	if listed != nil {
		t.Fatalf("worker that lists only its own repositories leased %#v", listed)
	}
	run := pollRun(t, webServer.URL, protocol.PollRequest{InstanceID: "registered", Name: "registered", Executors: []string{"test"}, ServeRegistered: true})
	if run == nil || run.Repository != "web-app" || run.RepositorySlug != "acme/web_app" {
		t.Fatalf("run = %#v", run)
	}
	status = getStatus(t, webServer.URL)
	if strings.Join(status.Repositories, ",") != "machinist,web-app" {
		t.Fatalf("available repositories = %v", status.Repositories)
	}
}

// Registering a repository changes every GitHub trigger's configuration, so
// the running trigger loops must stop, the durable trigger state must follow
// the new configuration, and the loops must resume with it.
func TestServerAppliesRegisteredRepositoryToRunningTriggers(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "plan.md"), []byte("{{machinist.prompt}}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	definitionPath := filepath.Join(directory, "config.toml")
	definition := "[commands.plan]\nexecutor = \"test\"\nprompt_file = \"plan.md\"\ntimeout = \"1m\"\n\n[repositories.api]\nslug = \"acme/api\"\n\n[triggers.github.intake]\nevery = \"1m\"\nlabel = \"machinist:requested\"\ncommand = \"plan\"\n"
	if err := os.WriteFile(definitionPath, []byte(definition), 0o600); err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(openTestStore(t, filepath.Join(directory, "machinist.db")), definitionPath, "secret", 0)
	if err != nil {
		t.Fatal(err)
	}
	searches := make(chan struct{}, 1)
	server.github = &fakeGitHubTriggerClient{searchStarted: searches, searchRelease: make(chan struct{})}
	server.schedulerEvery = time.Hour
	var reported []error
	var reportedMu sync.Mutex
	server.schedulerError = func(err error) {
		reportedMu.Lock()
		reported = append(reported, err)
		reportedMu.Unlock()
	}
	ctx, cancel := context.WithCancel(t.Context())
	stopped := make(chan error, 1)
	go func() { stopped <- server.runScheduler(ctx) }()
	awaitSearch(t, searches)

	webServer := httptest.NewServer(server.Handler())
	defer webServer.Close()
	status := getStatus(t, webServer.URL)
	response := postJSON(t, webServer.URL+"/api/v1/repositories", map[string]any{"slug": "acme/web"}, map[string]string{"Origin": webServer.URL, "X-Machinist-CSRF": status.CSRFToken})
	response.Body.Close()
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("registration status = %d", response.StatusCode)
	}

	triggers := server.currentTriggers()
	if len(triggers) != 1 || triggers[0].GitHubRepositories["web"] != "acme/web" {
		t.Fatalf("triggers = %#v", triggers)
	}
	snapshot, err := server.store.TriggerSnapshot(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot) != 1 || snapshot[0].ConfigSignature != triggers[0].Signature {
		t.Fatalf("durable trigger state = %#v, want signature %s", snapshot, triggers[0].Signature)
	}
	awaitSearch(t, searches)

	cancel()
	if err := <-stopped; err != nil {
		t.Fatal(err)
	}
	reportedMu.Lock()
	defer reportedMu.Unlock()
	for _, err := range reported {
		if errors.Is(err, ErrTriggerStale) {
			t.Fatalf("a trigger loop ran against stale configuration: %v", err)
		}
	}
}

func awaitSearch(t *testing.T, searches <-chan struct{}) {
	t.Helper()
	select {
	case <-searches:
	case <-time.After(5 * time.Second):
		t.Fatal("trigger loop did not search GitHub")
	}
}

func pollRun(t *testing.T, endpoint string, request protocol.PollRequest) *protocol.RunSpec {
	t.Helper()
	response := postJSON(t, endpoint+"/api/v1/workers/poll", request, map[string]string{"Authorization": "Bearer secret"})
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("poll status = %d", response.StatusCode)
	}
	var polled protocol.PollResponse
	if err := json.NewDecoder(response.Body).Decode(&polled); err != nil {
		t.Fatal(err)
	}
	return polled.Run
}
