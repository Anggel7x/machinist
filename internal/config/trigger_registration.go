package config

import (
	"errors"
	"fmt"
	"strings"

	"github.com/pelletier/go-toml/v2"
)

var (
	// ErrInvalidTrigger marks a trigger registration the caller can correct.
	ErrInvalidTrigger = errors.New("invalid trigger")
	// ErrTriggerExists marks a trigger registration whose name is taken.
	ErrTriggerExists = errors.New("trigger already registered")
)

const defaultGitHubTriggerEvery = "1m"

// GitHubTriggerRegistration is one GitHub trigger on one registered
// repository, as the control plane registers it.
type GitHubTriggerRegistration struct {
	Name       string `json:"name"`
	Repository string `json:"repository"`
	On         string `json:"on"`
	Label      string `json:"label"`
	Command    string `json:"command"`
	Prompt     string `json:"prompt,omitempty"`
	Every      string `json:"every"`
	Model      string `json:"model,omitempty"`
}

// githubTriggerBlock is the TOML body of one [triggers.github.NAME] table.
// Encoding through go-toml keeps free text such as the prompt correctly
// escaped.
type githubTriggerBlock struct {
	Every      string `toml:"every"`
	Label      string `toml:"label"`
	On         string `toml:"on,omitempty"`
	Repository string `toml:"repository"`
	Command    string `toml:"command"`
	Model      string `toml:"model,omitempty"`
	Prompt     string `toml:"prompt,omitempty"`
}

// RegisterGitHubTrigger appends one [triggers.github.NAME] block to the
// Machinist config at path. The name defaults to <command>-<repository>, and
// the trigger polls every minute unless told otherwise.
func RegisterGitHubTrigger(path string, input GitHubTriggerRegistration) (GitHubTriggerRegistration, error) {
	trigger := GitHubTriggerRegistration{
		Name: strings.TrimSpace(input.Name), Repository: strings.TrimSpace(input.Repository), On: strings.TrimSpace(input.On),
		Label: strings.TrimSpace(input.Label), Command: strings.TrimSpace(input.Command), Prompt: strings.TrimSpace(input.Prompt),
		Every: strings.TrimSpace(input.Every), Model: strings.TrimSpace(input.Model),
	}
	if trigger.Repository == "" || trigger.Command == "" || trigger.Label == "" {
		return GitHubTriggerRegistration{}, fmt.Errorf("%w: repository, label, and command are required", ErrInvalidTrigger)
	}
	if trigger.On == "" {
		trigger.On = GitHubIssueSubject
	}
	if trigger.Every == "" {
		trigger.Every = defaultGitHubTriggerEvery
	}
	if trigger.Name == "" {
		trigger.Name = trigger.Command + "-" + trigger.Repository
		if trigger.On == GitHubPullRequestSubject {
			trigger.Name += "-pull-requests"
		}
	}
	if !triggerNamePattern.MatchString(trigger.Name) {
		return GitHubTriggerRegistration{}, fmt.Errorf("%w: name %q may use only letters, digits, '.', '_' and '-'", ErrInvalidTrigger, trigger.Name)
	}
	err := appendConfigBlock(path, ErrInvalidTrigger, func(current Config, slugs map[string]string) (string, error) {
		if _, ok := current.Triggers.GitHub[trigger.Name]; ok {
			return "", fmt.Errorf("%w: github/%s already exists; choose another name", ErrTriggerExists, trigger.Name)
		}
		if _, ok := slugs[trigger.Repository]; !ok {
			return "", fmt.Errorf("%w: repository %q is not registered", ErrInvalidTrigger, trigger.Repository)
		}
		block := githubTriggerBlock{Every: trigger.Every, Label: trigger.Label, Repository: trigger.Repository, Command: trigger.Command, Model: trigger.Model, Prompt: trigger.Prompt}
		if trigger.On != GitHubIssueSubject {
			block.On = trigger.On
		}
		body, err := toml.Marshal(block)
		if err != nil {
			return "", fmt.Errorf("%w: %v", ErrInvalidTrigger, err)
		}
		return "\n[triggers.github." + tomlKey(trigger.Name) + "]\n" + string(body), nil
	})
	if err != nil {
		return GitHubTriggerRegistration{}, err
	}
	return trigger, nil
}
