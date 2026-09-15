// A host runs a pool of workers, and the pool names them <host>-<n>. The host
// is what you operate on — restart it, check its disk, rotate its credentials
// — while the worker is what holds a lease and appears in a run's history, so
// the page shows both rather than collapsing them.
const pooledName = /^(.*)-(\d+)$/;

export function hostFromWorkerName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "unknown";
  const match = pooledName.exec(trimmed);
  return match ? match[1] : trimmed;
}

export function groupWorkersByHost(workers) {
  const hosts = new Map();
  for (const worker of workers) {
    const host = hostFromWorkerName(worker.name);
    if (!hosts.has(host)) hosts.set(host, { host, workers: [], connected: 0, total: 0, repositories: new Set() });
    const entry = hosts.get(host);
    entry.workers.push(worker);
    entry.total += 1;
    if (worker.connected) entry.connected += 1;
    for (const repository of worker.repositories || []) entry.repositories.add(repository);
  }
  return [...hosts.values()]
    .map((entry) => ({
      ...entry,
      workers: entry.workers.sort((left, right) => left.name.localeCompare(right.name)),
      repositories: [...entry.repositories].sort(),
    }))
    .sort((left, right) => left.host.localeCompare(right.host));
}
