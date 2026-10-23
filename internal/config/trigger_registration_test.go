package config

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRegisterGitHubTriggerAppendsATriggerThatResolves(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "config.toml")
	original := "[commands.shepherd]\nexecutor = \"codex\"\n\n[repositories.web]\nslug = \"acme/web\"\n"
	writeTestFile(t, path, original)

	registered, err := RegisterGitHubTrigger(path, GitHubTriggerRegistration{
		Repository: "web", On: GitHubPullRequestSubject, Label: "machinist:shepherd", Command: "shepherd",
		Prompt: "Shepherd \"this\" pull request\nwith max_actions=8.",
	})
	if err != nil {
		t.Fatal(err)
	}
	if registered.Name != "shepherd-web-pull-requests" || registered.Every != "1m" {
		t.Fatalf("registered = %#v", registered)
	}
	triggers, err := LoadTriggers(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(triggers) != 1 || triggers[0].Identity != "github/shepherd-web-pull-requests" || triggers[0].Subject != GitHubPullRequestSubject || triggers[0].Repository != "web" || triggers[0].Prompt != "Shepherd \"this\" pull request\nwith max_actions=8." {
		t.Fatalf("triggers = %#v", triggers)
	}
	body, _ := os.ReadFile(path)
	if !strings.HasPrefix(string(body), original) {
		t.Fatalf("existing configuration was rewritten:\n%s", body)
	}
}

func TestRegisterGitHubTriggerRejectsWithoutTouchingTheConfiguration(t *testing.T) {
	original := "[commands.foreman]\nexecutor = \"codex\"\n\n[repositories.web]\nslug = \"acme/web\"\n\n[triggers.github.foreman-web]\nevery = \"1m\"\nlabel = \"machinist:requested\"\nrepository = \"web\"\ncommand = \"foreman\"\n"
	for _, test := range []struct {
		name  string
		input GitHubTriggerRegistration
		want  error
	}{
		{name: "taken name", input: GitHubTriggerRegistration{Repository: "web", Label: "other", Command: "foreman"}, want: ErrTriggerExists},
		{name: "label another trigger claims", input: GitHubTriggerRegistration{Name: "again", Repository: "web", Label: "Machinist:Requested", Command: "foreman"}, want: ErrInvalidTrigger},
		{name: "unregistered repository", input: GitHubTriggerRegistration{Repository: "api", Label: "go", Command: "foreman"}, want: ErrInvalidTrigger},
		{name: "unknown command", input: GitHubTriggerRegistration{Repository: "web", Label: "go", Command: "deploy"}, want: ErrInvalidTrigger},
		{name: "reserved label", input: GitHubTriggerRegistration{Name: "queued", Repository: "web", Label: "machinist:queued", Command: "foreman"}, want: ErrInvalidTrigger},
		{name: "unknown subject", input: GitHubTriggerRegistration{Name: "discussions", Repository: "web", Label: "go", On: "discussion", Command: "foreman"}, want: ErrInvalidTrigger},
		{name: "unsafe name", input: GitHubTriggerRegistration{Name: "web]\n[server", Repository: "web", Label: "go", Command: "foreman"}, want: ErrInvalidTrigger},
		{name: "missing label", input: GitHubTriggerRegistration{Repository: "web", Command: "foreman"}, want: ErrInvalidTrigger},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "config.toml")
			writeTestFile(t, path, original)
			if _, err := RegisterGitHubTrigger(path, test.input); !errors.Is(err, test.want) {
				t.Fatalf("error = %v, want %v", err, test.want)
			}
			if body, _ := os.ReadFile(path); string(body) != original {
				t.Fatalf("configuration changed:\n%s", body)
			}
		})
	}
}
