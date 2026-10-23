// Mirrors the control plane's own checks so the form can say what is wrong
// before a round trip; the server still decides.
const slugPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const namePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// logicalRepositoryName matches config.LogicalRepositoryName, so the name the
// form previews is the name the control plane registers.
export function logicalRepositoryName(repository) {
  const mapped = String(repository || "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "").replace(/[._]/g, "-");
  return mapped.replace(/^-+|-+$/g, "");
}

export function parseSlug(input) {
  let slug = String(input || "").trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const url = /^(?:https?:\/\/)?github\.com\/(.+)$/i.exec(slug);
  if (url) slug = url[1];
  return slug;
}

export function repositoryRegistration({ slug, name, parallel }) {
  const parsed = parseSlug(slug);
  if (!slugPattern.test(parsed) || parsed.includes("..")) return { error: "Enter a GitHub repository as owner/name." };
  const derived = logicalRepositoryName(parsed.split("/")[1]);
  const chosen = String(name || "").trim() || derived;
  if (!chosen || !namePattern.test(chosen)) return { error: "Names may use only letters, digits, '.', '_' and '-'." };
  const text = String(parallel ?? "").trim();
  let ceiling = 0;
  if (text) {
    ceiling = Number(text);
    if (!Number.isInteger(ceiling) || ceiling < 1) return { error: "Parallel runs must be a whole number of at least 1." };
  }
  const body = { slug: parsed, name: chosen };
  if (ceiling) body.parallel = ceiling;
  return { body, name: chosen, derived };
}

// repositoryRows joins what the control plane registers with what live
// workers can actually take, so a registration nobody serves is visible, and
// so is a repository a worker lists that was never registered.
export function repositoryRows(registered, workers) {
  const serving = new Map();
  for (const worker of workers || []) {
    if (!worker.connected) continue;
    for (const repository of worker.repositories || []) serving.set(repository, (serving.get(repository) || 0) + 1);
  }
  const rows = (registered || []).map((repository) => ({ ...repository, registered: true, workers: serving.get(repository.name) || 0 }));
  const names = new Set(rows.map((row) => row.name));
  for (const [name, count] of serving) {
    if (!names.has(name)) rows.push({ name, slug: "", registered: false, workers: count });
  }
  return rows.sort((left, right) => left.name.localeCompare(right.name));
}
