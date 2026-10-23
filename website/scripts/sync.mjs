export function normalizePackage(metadata, source = {}) {
  const version = metadata["dist-tags"]?.latest ?? null;
  const current = metadata.versions?.[version] ?? {};
  const deprecated = current.deprecated || null;
  return {
    name: metadata.name,
    shortName: metadata.name.replace("@ohos-npm-ports/", ""),
    upstream: source.upstream ?? null,
    directories: source.directories ?? [],
    description: current.description || metadata.description || "暂无包描述。",
    version,
    deprecated,
    status: deprecated ? "deprecated" : version ? "active" : "untagged",
    license: typeof current.license === "string" ? current.license : null,
    publishedAt: metadata.time?.[version] ?? null,
    versions: Object.keys(metadata.versions ?? {})
      .map((v) => ({
        version: v,
        tags: Object.keys(metadata["dist-tags"] ?? {}).filter(
          (t) => metadata["dist-tags"][t] === v,
        ),
        deprecated: metadata.versions[v].deprecated || null,
      }))
      .reverse(),
  };
}
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = resolve(root, "..");
const scope = "@ohos-npm-ports/";

export async function discoverSources(portsRoot) {
  const sources = new Map();
  for (const port of await readdir(portsRoot, { withFileTypes: true })) {
    if (!port.isDirectory()) continue;
    for (const version of await readdir(join(portsRoot, port.name), {
      withFileTypes: true,
    })) {
      if (!version.isDirectory()) continue;
      const directory = `ports/${port.name}/${version.name}`;
      const files = [];
      async function walk(path) {
        for (const entry of await readdir(path, { withFileTypes: true })) {
          if (entry.isDirectory() && entry.name === "patchs") await walk(join(path, entry.name));
          else if (entry.isFile() && /\.(?:sh|patch|json|js)$/.test(entry.name))
            files.push(await readFile(join(path, entry.name), "utf8"));
        }
      }
      await walk(join(portsRoot, port.name, version.name));
      const text = files.join("\n");
      const names = new Set(
        [`${scope}${port.name}`, ...text.matchAll(/@ohos-npm-ports\/[a-z0-9][a-z0-9._-]*/g)].map(
          (v) => (typeof v === "string" ? v : v[0]),
        ),
      );
      const original =
        text.match(/^\/\/ @test-package: (\S+)/m)?.[1] ??
        text.match(/^-\s*"name":\s*"([^"]+)"/m)?.[1];
      for (const name of names) {
        const existing = sources.get(name) ?? {
          directories: [],
          upstream: null,
        };
        existing.directories.push(directory);
        if (name === `${scope}${port.name}` && original && !original.startsWith(scope))
          existing.upstream = original;
        sources.set(name, existing);
      }
    }
  }
  for (const [name, source] of sources) {
    const primary = name.slice(scope.length);
    source.directories.sort(
      (a, b) =>
        Number(b.split("/")[1] === primary) - Number(a.split("/")[1] === primary) ||
        a.localeCompare(b),
    );
  }
  return sources;
}

export async function syncData({
  fetchMetadata = async (name) => {
    const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(45000),
        });
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`${name}: registry returned ${response.status}`);
        return await response.json();
      } catch (error) {
        if (attempt === 2) throw error;
        await new Promise((done) => setTimeout(done, 1500 * (attempt + 1)));
      }
    }
  },
  output = join(root, "public"),
} = {}) {
  const sources = await discoverSources(join(repository, "ports"));
  const entries = [...sources];
  const packages = [];
  const unpublished = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < entries.length) {
        const [name, source] = entries[next++];
        const metadata = await fetchMetadata(name);
        if (!metadata) {
          unpublished.push(name);
          continue;
        }
        if (metadata.name !== name) throw new Error(`Registry name mismatch: ${name}`);
        packages.push(normalizePackage(metadata, source));
      }
    }),
  );
  if (!packages.length) throw new Error("Refusing to publish an empty catalog");
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, "data.json"),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      repository: "https://github.com/ohos-npm-ports/ohos-npm-ports",
      packages: packages.sort((a, b) => a.name.localeCompare(b.name)),
    }),
  );
  console.log(
    `Built ${packages.length} published packages; ${unpublished.length} source candidates not published.`,
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await syncData();
