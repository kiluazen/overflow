export function compareJobs(a, b) {
  const activeA = a.status === "queued" || a.status === "claimed";
  const activeB = b.status === "queued" || b.status === "claimed";
  return Number(activeB) - Number(activeA) ||
    (activeB ? Number(b.createdAt || 0) - Number(a.createdAt || 0)
      : Number(b.completedAt || b.createdAt || 0) - Number(a.completedAt || a.createdAt || 0)) ||
    String(a.id).localeCompare(String(b.id));
}
