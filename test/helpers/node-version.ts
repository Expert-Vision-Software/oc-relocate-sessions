export function nodeMajorVersion(): number | null {
  const nodeBin = Bun.which("node");
  if (nodeBin === null) return null;
  const proc = Bun.spawnSync([nodeBin, "--version"]);
  const version = proc.stdout.toString().trim();
  const major = Number.parseInt(version.replace(/^v/, "").split(".")[0] ?? "0", 10);
  return Number.isNaN(major) ? null : major;
}
