package controlplane

import "time"

// Machinist reads GitHub to report an outcome, never to act on one. Merging is
// adjudicated by the repository's own policy workflow; nothing here decides or
// changes anything on GitHub.
const (
	// OutcomeNone is a job whose issue no pull request references yet.
	OutcomeNone = "none"
	// OutcomeLanded is the only outcome that means the work reached the base branch.
	OutcomeLanded = "landed"
	// OutcomeAbandoned is a pull request closed without merging.
	OutcomeAbandoned = "abandoned"
	// OutcomeFailing is a pull request with at least one failed check.
	OutcomeFailing = "failing"
	// OutcomeBlocked is a green pull request the policy workflow refuses to merge.
	OutcomeBlocked = "blocked"
	// OutcomeWaiting is a pull request whose checks have not finished.
	OutcomeWaiting = "waiting"
	// OutcomeDraft is a pull request still marked as a draft.
	OutcomeDraft = "draft"
	// OutcomeUnlanded is a green, open, unmerged pull request.
	OutcomeUnlanded = "unlanded"
)

const (
	ChecksNone    = "none"
	ChecksPassing = "passing"
	ChecksFailing = "failing"
	ChecksPending = "pending"
)

// unlandedGrace is how long a green pull request may sit unmerged before it is
// worth anyone's attention. Checks legitimately take time, so an unlanded pull
// request is only a signal once it has stopped moving.
const unlandedGrace = 30 * time.Minute

// PullRequestMirror is the cached GitHub state for one pull request. It holds
// change size as scalars rather than file and commit lists: the lists are
// unbounded, and they are what the agent reads with its own tooling anyway.
type PullRequestMirror struct {
	Repository       string    `json:"repository"`
	Number           int       `json:"number"`
	URL              string    `json:"url"`
	Title            string    `json:"title"`
	State            string    `json:"state"`
	IsDraft          bool      `json:"is_draft"`
	Mergeable        bool      `json:"mergeable"`
	MergeStateStatus string    `json:"merge_state_status"`
	ReviewDecision   string    `json:"review_decision,omitempty"`
	MergedAt         time.Time `json:"merged_at,omitempty"`
	HeadRefName      string    `json:"head_ref_name"`
	HeadRefOID       string    `json:"head_ref_oid"`
	BaseRefName      string    `json:"base_ref_name"`
	Additions        int       `json:"additions"`
	Deletions        int       `json:"deletions"`
	ChangedFiles     int       `json:"changed_files"`
	Commits          int       `json:"commits"`
	ChecksState      string    `json:"checks_state"`
	ChecksPassed     int       `json:"checks_passed"`
	ChecksFailed     int       `json:"checks_failed"`
	ChecksPending    int       `json:"checks_pending"`
	IssueNumber      int       `json:"issue_number"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
	FetchedAt        time.Time `json:"fetched_at"`
}

// IssueMirror is the cached GitHub state for one issue. Labels are mirrored
// because label drift has silently consumed requests before: an intake label
// removed with nothing admitted is invisible without them.
type IssueMirror struct {
	Repository string    `json:"repository"`
	Number     int       `json:"number"`
	URL        string    `json:"url"`
	State      string    `json:"state"`
	Labels     []string  `json:"labels,omitempty"`
	UpdatedAt  time.Time `json:"updated_at"`
	FetchedAt  time.Time `json:"fetched_at"`
}

// DeriveOutcome reports what the work did, as distinct from what the run did,
// and whether it needs attention. Urgency comes from the reason rather than a
// flat timer: a failed check or a refused merge is a problem now, while a green
// pull request is only a problem once it has been ignored for the grace period.
//
// Staleness is measured from when the pull request was opened, not from its
// UpdatedAt: a comment or a check run moves UpdatedAt, so a busy pull request
// would reset its own grace period indefinitely and never be flagged. Age since
// opening cannot be reset by activity, and a pull request open for hours that
// has only just gone green has genuinely been unlanded for hours.
func DeriveOutcome(pull *PullRequestMirror, now time.Time, grace time.Duration) (string, bool) {
	if pull == nil {
		return OutcomeNone, false
	}
	switch {
	case pull.State == "merged" || !pull.MergedAt.IsZero():
		return OutcomeLanded, false
	case pull.State == "closed":
		return OutcomeAbandoned, false
	case pull.ChecksState == ChecksFailing:
		return OutcomeFailing, true
	case pull.MergeStateStatus == "BLOCKED":
		return OutcomeBlocked, true
	case pull.IsDraft:
		return OutcomeDraft, pull.stale(now, grace)
	case pull.ChecksState == ChecksPending:
		return OutcomeWaiting, false
	default:
		return OutcomeUnlanded, pull.stale(now, grace)
	}
}

func (p PullRequestMirror) stale(now time.Time, grace time.Duration) bool {
	return !p.CreatedAt.IsZero() && now.Sub(p.CreatedAt) > grace
}
