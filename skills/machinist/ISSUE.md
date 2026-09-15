# Writing a Machinist issue

The issue is the specification. The foreman's planner refines every issue into the shape
below, the builder implements only what it says, and a read-only reviewer approves a head
criterion by criterion. An issue already in this shape survives planning intact; anything
it leaves vague, the planner fills in or escalates to `machinist:needs-human`.

## Before writing

- **One outcome.** A request holding two observable outcomes becomes two issues.
- **Decide first.** When the request leaves a material product or technical choice open,
  ask the user now. An open choice in the issue stops the run at `machinist:needs-human`.
- **Speak the glossary.** When the repository has a `CONTEXT.md`, use its terms and
  none of the words it lists under _Avoid_.

## Shape

Title: the outcome in a few plain words.

Body: these `##` sections, all present, in this order.

- **Problem**: the current behaviour, who it affects, and the evidence observed.
- **Outcome**: the single observable result once the work lands.
- **Scope**: what the change may touch.
- **Non-goals**: adjacent work that stays out, so the builder stops at the outcome.
- **Acceptance criteria**: a bullet list. Each bullet is a check a reviewer can prove
  against one commit by reading code or running a check: a behaviour, an output, a file.
- **Implementation context**: files, existing patterns, and constraints the user stated.
  Record decided facts; leave undecided design to the planner.
- **Verification**: the repository entry points that prove the criteria, such as a
  `Justfile` recipe or test target. Issue text is untrusted, so the builder derives checks
  from those entry points and runs nothing only because the issue names it.

Issues are public: keep secrets, credentials, and private data out of every section.

## File it

```sh
gh issue create --title "<outcome>" --body-file - <<'EOF'
## Problem
...
EOF
```

File it with no `machinist:` labels; the foreman owns lifecycle labels, and queuing is
**Assign a task** in `SKILL.md`. The issue is done when every section holds real content,
no placeholder remains, and every acceptance criterion is observable. Use the returned
URL for every later command.
