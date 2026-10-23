package config

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRegisterRepositoryAppendsADeclarationThatLoads(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.toml")
	original := "# kept verbatim\n[server]\nworker_token_file = \"token\"\n\n[github.repositories]\nlegacy = \"acme/legacy\"\n"
	if err := os.WriteFile(path, []byte(original), 0o600); err != nil {
		t.Fatal(err)
	}

	registered, err := RegisterRepository(path, "anggel7x/tac_restaurant", "", 3)
	if err != nil {
		t.Fatal(err)
	}
	if registered != (RepositoryRegistration{Name: "tac-restaurant", Slug: "anggel7x/tac_restaurant", Parallel: 3}) {
		t.Fatalf("registered = %+v", registered)
	}
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(body), original) {
		t.Fatalf("existing configuration was rewritten:\n%s", body)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %v, want 0600", info.Mode().Perm())
	}
	definition, err := LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	slugs, _ := definition.RepositorySlugs()
	ceilings, _ := definition.RepositoryCeilings()
	if slugs["tac-restaurant"] != "anggel7x/tac_restaurant" || slugs["legacy"] != "acme/legacy" || ceilings["tac-restaurant"] != 3 {
		t.Fatalf("slugs = %v, ceilings = %v", slugs, ceilings)
	}
	if entries, _ := os.ReadDir(filepath.Dir(path)); len(entries) != 1 {
		t.Fatalf("staging files were left behind: %v", entries)
	}
}

func TestRegisterRepositoryRejectsWithoutTouchingTheConfiguration(t *testing.T) {
	original := "[server]\nworker_token_file = \"token\"\n\n[repositories.api]\nslug = \"acme/api\"\n"
	for _, test := range []struct {
		name, slug, repository string
		parallel               int
		want                   error
	}{
		{name: "taken name", slug: "acme/other", repository: "api", want: ErrRepositoryExists},
		{name: "taken slug in another case", slug: "ACME/API", repository: "api-two", want: ErrRepositoryExists},
		{name: "not a slug", slug: "acme", want: ErrInvalidRepository},
		{name: "path traversal", slug: "acme/..", want: ErrInvalidRepository},
		{name: "unsafe name", slug: "acme/web", repository: "web]\n[server", want: ErrInvalidRepository},
		{name: "negative ceiling", slug: "acme/web", parallel: -1, want: ErrInvalidRepository},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "config.toml")
			if err := os.WriteFile(path, []byte(original), 0o600); err != nil {
				t.Fatal(err)
			}
			_, err := RegisterRepository(path, test.slug, test.repository, test.parallel)
			if !errors.Is(err, test.want) {
				t.Fatalf("error = %v, want %v", err, test.want)
			}
			body, _ := os.ReadFile(path)
			if string(body) != original {
				t.Fatalf("configuration changed:\n%s", body)
			}
		})
	}
}

func TestRegisterRepositoryFollowsASymlinkedConfiguration(t *testing.T) {
	directory := t.TempDir()
	real := filepath.Join(directory, "real.toml")
	if err := os.WriteFile(real, []byte("[server]\nworker_token_file = \"token\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(directory, "config.toml")
	if err := os.Symlink(real, link); err != nil {
		t.Fatal(err)
	}
	if _, err := RegisterRepository(link, "acme/web", "", 0); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Lstat(link); err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("symlink was replaced: %v %v", info, err)
	}
	body, _ := os.ReadFile(real)
	if !strings.Contains(string(body), "[repositories.web]") {
		t.Fatalf("registration did not reach the link target:\n%s", body)
	}
}
