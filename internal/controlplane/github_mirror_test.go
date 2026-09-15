package controlplane

import (
	"testing"
	"time"
)

func TestDeriveOutcomeClassifiesWorkAndFlagsOnlyWhatNeedsAttention(t *testing.T) {
	now := time.Date(2026, time.September, 15, 12, 0, 0, 0, time.UTC)
	fresh := now.Add(-5 * time.Minute)
	stale := now.Add(-2 * time.Hour)

	for name, testCase := range map[string]struct {
		pull        *PullRequestMirror
		wantOutcome string
		wantFlagged bool
	}{
		"no pull request": {pull: nil, wantOutcome: OutcomeNone},
		"merged": {
			pull:        &PullRequestMirror{State: "merged", MergedAt: fresh, ChecksState: ChecksPassing, UpdatedAt: fresh},
			wantOutcome: OutcomeLanded,
		},
		"closed without merging": {
			pull:        &PullRequestMirror{State: "closed", ChecksState: ChecksPassing, UpdatedAt: stale},
			wantOutcome: OutcomeAbandoned,
		},
		"failing checks flag immediately": {
			pull:        &PullRequestMirror{State: "open", ChecksState: ChecksFailing, ChecksFailed: 2, UpdatedAt: fresh},
			wantOutcome: OutcomeFailing, wantFlagged: true,
		},
		"merge refused by policy flags immediately": {
			pull:        &PullRequestMirror{State: "open", ChecksState: ChecksPassing, MergeStateStatus: "BLOCKED", UpdatedAt: fresh},
			wantOutcome: OutcomeBlocked, wantFlagged: true,
		},
		"pending checks are not a problem": {
			pull:        &PullRequestMirror{State: "open", ChecksState: ChecksPending, ChecksPending: 3, UpdatedAt: fresh},
			wantOutcome: OutcomeWaiting,
		},
		"green and unmerged inside the grace period": {
			pull:        &PullRequestMirror{State: "open", ChecksState: ChecksPassing, UpdatedAt: fresh},
			wantOutcome: OutcomeUnlanded,
		},
		"green and unmerged past the grace period": {
			pull:        &PullRequestMirror{State: "open", ChecksState: ChecksPassing, UpdatedAt: stale},
			wantOutcome: OutcomeUnlanded, wantFlagged: true,
		},
		"draft past the grace period": {
			pull:        &PullRequestMirror{State: "open", IsDraft: true, ChecksState: ChecksPassing, UpdatedAt: stale},
			wantOutcome: OutcomeDraft, wantFlagged: true,
		},
	} {
		t.Run(name, func(t *testing.T) {
			outcome, flagged := DeriveOutcome(testCase.pull, now, unlandedGrace)
			if outcome != testCase.wantOutcome || flagged != testCase.wantFlagged {
				t.Fatalf("outcome = %q flagged = %v, want %q %v", outcome, flagged, testCase.wantOutcome, testCase.wantFlagged)
			}
		})
	}
}
