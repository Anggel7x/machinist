# Machinist

Machinist admits work from GitHub and from people, then runs coding agents against
registered repositories. This glossary fixes the language used across the control
plane, the workers, and the prompts, which have drifted into using one word for
several things.

## Work

**Job**:
One unit of requested work, admitted either by a trigger or by a person.
_Avoid_: Task, request

**Run**:
One execution of a job by a single coding-agent process.

**State**:
What the *process* did — where a job or run sits in its execution lifecycle
(queued, running, succeeded, failed, timed out, cancelled). State says nothing
about whether the work was any good or whether it reached the default branch.
_Avoid_: Status

**Outcome**:
What the *work* did — whether the change reached the repository: landed,
unlanded, blocked, failing, waiting, draft, abandoned, or none. A job whose run
succeeded and whose pull request sits unmerged has a good state and no outcome.
_Avoid_: Result, status

**Landed**:
The outcome in which a job's pull request has been merged into its base branch.
_Avoid_: Done, complete, shipped

## Repositories

**Repository**:
The logical name a job, trigger, and worker all use to refer to the same
codebase. It is a machinist-internal identifier, not a GitHub name.
_Avoid_: Repo name, project

**Repository slug**:
A codebase's `owner/name` identity on GitHub.
_Avoid_: Repository, repo

**Checkout**:
The directory on a worker's filesystem holding a repository's working copy.
_Avoid_: Repository, repo path, clone

## Execution

**Worker**:
A process that claims one job at a time from the control plane and executes it.
A worker is not tied to any one repository; it takes whatever work its host is
registered for.
_Avoid_: Agent, runner, node, slot, lane

**Pool**:
The set of workers one host keeps alive, and the supervisor that keeps them so.
_Avoid_: Fleet, cluster

**Worker host**:
A machine running a pool. Policy about repositories is decided centrally;
a host decides only how many workers it is willing to run.
_Avoid_: Node, box, runner

**Ceiling**:
The maximum number of runs one repository may have in flight at once, across
every host. A policy about a codebase, not about a machine.
_Avoid_: Limit, cap, concurrency

**Executor**:
The coding-agent program a run is carried out by, such as Claude Code or Codex.
_Avoid_: Model, agent, backend

**Command**:
A named, versioned pairing of a prompt with the executor that runs it — foreman,
audit, shepherd.
_Avoid_: Workflow, recipe
