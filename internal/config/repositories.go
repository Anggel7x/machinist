package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

var (
	// ErrInvalidRepository marks a registration the caller can correct: a bad
	// slug, name, or ceiling, or one the configuration would reject.
	ErrInvalidRepository = errors.New("invalid repository")
	// ErrRepositoryExists marks a registration whose name or slug is taken.
	ErrRepositoryExists = errors.New("repository already registered")
)

// registration serialises writers inside one process. The file itself is
// replaced atomically, so a reader never sees a half-written configuration.
var registration sync.Mutex

// RepositoryRegistration is one repository as the control plane registers it.
type RepositoryRegistration struct {
	Name     string `json:"name"`
	Slug     string `json:"slug"`
	Parallel int    `json:"parallel,omitempty"`
}

// RegisterRepository appends one [repositories.NAME] block to the Machinist
// config at path. The name defaults to the repository half of the slug.
func RegisterRepository(path, slug, name string, parallel int) (RepositoryRegistration, error) {
	repository, err := repositoryDeclaration(slug, name, parallel)
	if err != nil {
		return RepositoryRegistration{}, err
	}
	err = appendConfigBlock(path, ErrInvalidRepository, func(current Config, slugs map[string]string) (string, error) {
		for existingName, existingSlug := range slugs {
			if existingName == repository.Name {
				return "", fmt.Errorf("%w: %q is already registered as %q", ErrRepositoryExists, existingName, existingSlug)
			}
			if strings.EqualFold(existingSlug, repository.Slug) {
				return "", fmt.Errorf("%w: %q is already registered as %q", ErrRepositoryExists, existingSlug, existingName)
			}
		}
		return repository.block(), nil
	})
	if err != nil {
		return RepositoryRegistration{}, err
	}
	return repository, nil
}

// appendConfigBlock appends the block that build derives from the current
// configuration. The new file is proved to load, triggers included, before it
// replaces the old one, so a rejected change leaves the configuration
// untouched; a candidate that fails to load is reported as invalid.
func appendConfigBlock(path string, invalid error, build func(Config, map[string]string) (string, error)) error {
	registration.Lock()
	defer registration.Unlock()

	target, err := filepath.EvalSymlinks(path)
	if err != nil {
		return fmt.Errorf("resolve Machinist config %q: %w", path, err)
	}
	current, slugs, err := loadRepositoryPolicy(target)
	if err != nil {
		return err
	}
	block, err := build(current, slugs)
	if err != nil {
		return err
	}

	info, err := os.Stat(target)
	if err != nil {
		return fmt.Errorf("inspect Machinist config %q: %w", target, err)
	}
	body, err := readBoundedFile(target, maxConfigBytes)
	if err != nil {
		return fmt.Errorf("read Machinist config %q: %w", target, err)
	}
	if len(body) > 0 && body[len(body)-1] != '\n' {
		body = append(body, '\n')
	}
	body = append(body, block...)

	// The candidate sits beside the original so relative paths resolve the
	// same way and the final rename stays on one filesystem.
	candidate, err := os.CreateTemp(filepath.Dir(target), "."+filepath.Base(target)+".*")
	if err != nil {
		return fmt.Errorf("stage Machinist config: %w", err)
	}
	candidatePath := candidate.Name()
	committed := false
	defer func() {
		if !committed {
			_ = os.Remove(candidatePath)
		}
	}()
	_, writeErr := candidate.Write(body)
	chmodErr := candidate.Chmod(info.Mode().Perm())
	syncErr := candidate.Sync()
	closeErr := candidate.Close()
	if err := errors.Join(writeErr, chmodErr, syncErr, closeErr); err != nil {
		return fmt.Errorf("stage Machinist config: %w", err)
	}
	if _, _, err := loadRepositoryPolicy(candidatePath); err != nil {
		return fmt.Errorf("%w: %v", invalid, err)
	}
	if err := os.Rename(candidatePath, target); err != nil {
		return fmt.Errorf("replace Machinist config %q: %w", target, err)
	}
	committed = true
	return nil
}

// loadRepositoryPolicy loads everything a registration can change, the
// triggers that watch registered repositories included.
func loadRepositoryPolicy(path string) (Config, map[string]string, error) {
	definition, err := loadConfigFile(path)
	if err != nil {
		return Config{}, nil, err
	}
	slugs, err := definition.RepositorySlugs()
	if err != nil {
		return Config{}, nil, err
	}
	if _, err := definition.RepositoryCeilings(); err != nil {
		return Config{}, nil, err
	}
	if _, err := definition.ResolveTriggers(); err != nil {
		return Config{}, nil, err
	}
	return definition, slugs, nil
}

// repositoryDeclaration validates one registration before anything is written.
func repositoryDeclaration(slug, requested string, parallel int) (RepositoryRegistration, error) {
	slug = strings.TrimSpace(slug)
	_, repository, ok := strings.Cut(slug, "/")
	if !ok || !repositoryPattern.MatchString(slug) || strings.Contains(slug, "..") {
		return RepositoryRegistration{}, fmt.Errorf("%w: %q must be an OWNER/REPO slug", ErrInvalidRepository, slug)
	}
	name := strings.TrimSpace(requested)
	if name == "" {
		name = LogicalRepositoryName(repository)
	}
	if name == "" {
		return RepositoryRegistration{}, fmt.Errorf("%w: %q has no usable name; choose one", ErrInvalidRepository, slug)
	}
	if !triggerNamePattern.MatchString(name) {
		return RepositoryRegistration{}, fmt.Errorf("%w: name %q may use only letters, digits, '.', '_' and '-'", ErrInvalidRepository, name)
	}
	if parallel < 0 {
		return RepositoryRegistration{}, fmt.Errorf("%w: parallel cannot be negative", ErrInvalidRepository)
	}
	return RepositoryRegistration{Name: name, Slug: slug, Parallel: parallel}, nil
}

func (r RepositoryRegistration) block() string {
	block := fmt.Sprintf("\n[repositories.%s]\nslug = %q\n", tomlKey(r.Name), r.Slug)
	if r.Parallel > 0 {
		block += fmt.Sprintf("parallel = %d\n", r.Parallel)
	}
	return block
}

// LogicalRepositoryName derives a repository's name from the repository half
// of its slug, so `anggel7x/tac_restaurant` registers as `tac-restaurant`.
func LogicalRepositoryName(repository string) string {
	lowered := strings.ToLower(strings.TrimSpace(repository))
	mapped := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			return r
		case r == '.', r == '-', r == '_':
			return '-'
		default:
			return -1
		}
	}, lowered)
	return strings.Trim(mapped, "-")
}

// tomlKey writes a validated name as one TOML key: a bare key splits on '.',
// so a name containing one is quoted.
func tomlKey(name string) string {
	if strings.Contains(name, ".") {
		return `"` + name + `"`
	}
	return name
}
