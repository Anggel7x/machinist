package cli

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"

	"github.com/owainlewis/machinist/internal/config"
)

func newRepoCommand(options *commandOptions) *cobra.Command {
	repo := &cobra.Command{
		Use:   "repo",
		Short: "Manage the repositories Machinist works in",
	}
	repo.AddCommand(newRepoAddCommand(options))
	return repo
}

// newRepoAddCommand registers one repository with the control plane. It writes
// configuration and validates it; it deliberately does not clone. A host
// materialises its own checkout on first dispatch, which is the only thing
// that works when the control plane and the worker are different machines.
func newRepoAddCommand(options *commandOptions) *cobra.Command {
	var parallel int
	var name string
	add := &cobra.Command{
		Use:   "add OWNER/REPO",
		Short: "Register a repository so Machinist can read and work in it",
		Args:  cobra.ExactArgs(1),
		RunE: func(command *cobra.Command, args []string) error {
			path, err := repoConfigPath(options.configPath)
			if err != nil {
				return err
			}
			logical, block, err := repositoryDeclaration(args[0], name, parallel)
			if err != nil {
				return err
			}
			definition, err := config.LoadConfig(path)
			if err != nil {
				return err
			}
			slugs, err := definition.RepositorySlugs()
			if err != nil {
				return err
			}
			if existing, ok := slugs[logical]; ok {
				return fmt.Errorf("repository %q is already registered as %q", logical, existing)
			}
			if err := appendConfigBlock(path, block); err != nil {
				return err
			}
			// Prove the file still loads, and undo the edit if it does not, so a
			// rejected registration cannot leave the control plane unstartable.
			if _, err := config.LoadConfig(path); err != nil {
				return errors.Join(fmt.Errorf("register repository %q: %w", logical, err), truncateConfigBlock(path, block))
			}
			fmt.Fprintf(options.stdout, "registered %s as %s\n", args[0], logical)
			fmt.Fprintf(options.stderr, "machinist: add [repositories.%s] path to each worker.toml, or let the worker clone it on first dispatch\n", logical)
			return nil
		},
	}
	add.Flags().IntVar(&parallel, "parallel", 0, "how many of this repository's runs may be in flight at once")
	add.Flags().StringVar(&name, "name", "", "logical repository name (defaults to the repository part of the slug)")
	return add
}

func repoConfigPath(configured string) (string, error) {
	if strings.TrimSpace(configured) != "" {
		return filepath.Abs(configured)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("find user home directory: %w", err)
	}
	return filepath.Join(home, ".machinist", "config.toml"), nil
}

// repositoryDeclaration returns the logical name and the TOML block for one
// repository. The logical name defaults to the repository half of the slug, so
// `anggel7x/tac_restaurant` registers as `tac-restaurant`.
func repositoryDeclaration(slug, requested string, parallel int) (string, string, error) {
	slug = strings.TrimSpace(slug)
	owner, repository, ok := strings.Cut(slug, "/")
	if !ok || strings.TrimSpace(owner) == "" || strings.TrimSpace(repository) == "" || strings.Contains(slug, "..") {
		return "", "", fmt.Errorf("repository %q must be an OWNER/REPO slug", slug)
	}
	logical := strings.TrimSpace(requested)
	if logical == "" {
		logical = logicalRepositoryName(repository)
	}
	if logical == "" {
		return "", "", fmt.Errorf("repository %q has no usable logical name; pass --name", slug)
	}
	if parallel < 0 {
		return "", "", errors.New("parallel cannot be negative")
	}
	block := fmt.Sprintf("\n[repositories.%s]\nslug = %q\n", logical, slug)
	if parallel > 0 {
		block += fmt.Sprintf("parallel = %d\n", parallel)
	}
	return logical, block, nil
}

func logicalRepositoryName(repository string) string {
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

func appendConfigBlock(path, block string) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return fmt.Errorf("open Machinist config %q: %w", path, err)
	}
	defer file.Close()
	if _, err := file.WriteString(block); err != nil {
		return fmt.Errorf("write Machinist config %q: %w", path, err)
	}
	return file.Sync()
}

func truncateConfigBlock(path, block string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	size := info.Size() - int64(len(block))
	if size < 0 {
		return fmt.Errorf("cannot undo the edit to %q", path)
	}
	return os.Truncate(path, size)
}
