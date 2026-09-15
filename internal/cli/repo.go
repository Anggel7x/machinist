package cli

import (
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
			repository, err := config.RegisterRepository(path, args[0], name, parallel)
			if err != nil {
				return err
			}
			fmt.Fprintf(options.stdout, "registered %s as %s\n", repository.Slug, repository.Name)
			fmt.Fprintln(options.stderr, "machinist: restart a running control plane to apply it, or register repositories from the control plane's Repositories page")
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
