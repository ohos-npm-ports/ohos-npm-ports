// Ports whose files changed (test.js aside) while their published version stayed the same. Publishing is judged
// against npm, so such a change merges fine but is not published until the revision is bumped.
// baseVersion/headVersion return a port's version string, or null when the port does not exist on that side.
export function unbumpedPorts(changedFiles, { baseVersion, headVersion }) {
  const dirs = new Set();
  for (const file of changedFiles) {
    const match = /^(ports\/[^/]+\/[^/]+)\/(.+)$/.exec(file);
    if (match && match[2] !== 'test.js') dirs.add(match[1]);
  }
  return [...dirs].sort().filter((dir) => {
    const base = baseVersion(dir);
    return base !== null && base === headVersion(dir);
  });
}
