// Mirrors the control plane's checks on a GitHub trigger so the form can say
// what is wrong before a round trip; the server still decides, including
// whether another trigger already claims the label on that repository.
const namePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const durationPattern = /^\d+(?:\.\d+)?(?:ms|s|m|h)(?:\d+(?:\.\d+)?(?:ms|s|m|h))*$/;

export const subjects = [
  { value: "issue", label: "Label added to an issue" },
  { value: "pull_request", label: "Label added to a pull request" },
];

export function defaultTriggerName({ command, repository, on }) {
  if (!command || !repository) return "";
  return `${command}-${repository}${on === "pull_request" ? "-pull-requests" : ""}`;
}

export function githubTriggerRegistration(input) {
  const repository = String(input.repository || "").trim();
  const command = String(input.command || "").trim();
  const on = input.on === "pull_request" ? "pull_request" : "issue";
  const label = String(input.label || "").trim();
  if (!repository) return { error: "Choose a registered repository." };
  if (!command) return { error: "Choose the command to run." };
  if (!label || label.length > 50 || /[,\r\n]/.test(label)) return { error: "Labels must be one line of at most 50 characters without commas." };
  if (label.toLowerCase() === "machinist:queued") return { error: "machinist:queued is reserved for work Machinist has admitted." };
  const every = String(input.every || "").trim() || "1m";
  if (!durationPattern.test(every)) return { error: "Poll interval must be a duration such as 1m or 30s." };
  const name = String(input.name || "").trim() || defaultTriggerName({ command, repository, on });
  if (!namePattern.test(name)) return { error: "Names may use only letters, digits, '.', '_' and '-'." };
  const body = { name, repository, on, label, command, every };
  const prompt = String(input.prompt || "").trim();
  if (prompt) body.prompt = prompt;
  const model = String(input.model || "").trim();
  if (model) body.model = model;
  return { body };
}

// triggerDescription is one line saying what a configured trigger does.
export function triggerDescription(definition) {
  if (!definition) return "";
  const where = definition.repositories?.length ? definition.repositories.join(", ") : "every registered repository";
  if (definition.family === "github") {
    const target = definition.on === "pull_request" ? "a pull request" : "an issue";
    return `Runs ${definition.command} when ${definition.label} is added to ${target} in ${where}.`;
  }
  const cadence = definition.schedule ? `on ${definition.schedule}` : `every ${definition.every}`;
  return `Runs ${definition.command} ${cadence} in ${where}.`;
}
