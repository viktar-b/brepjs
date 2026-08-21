import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendorRoot = resolve(projectRoot, 'vendor');
const manifest = JSON.parse(await readFile(resolve(vendorRoot, 'manifest.json'), 'utf8'));
const packageJson = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8'));
const failures = [];
const expectedTarballs = new Set();
const commitSuffix = manifest.source?.commit?.slice(0, 12);

if (manifest.schemaVersion !== 2) failures.push('manifest.json: schemaVersion must be 2');
if (manifest.freeze?.status !== 'frozen')
  failures.push('manifest.json: freeze status must be frozen');
if (!/^[0-9a-f]{40}$/u.test(manifest.source?.commit ?? '')) {
  failures.push('manifest.json: source commit must be a full Git SHA');
}

for (const item of manifest.packages ?? []) {
  expectedTarballs.add(item.file);
  if (item.artifactKind !== 'workspace-snapshot') {
    failures.push(`${item.name}: artifactKind must be workspace-snapshot`);
  }
  if (!item.file?.endsWith(`-workspace-snapshot-${commitSuffix}.tgz`)) {
    failures.push(`${item.name}: filename must carry workspace snapshot commit ${commitSuffix}`);
  }
  if (item.registryAtFreeze?.sameVersionRelease?.matchesSnapshot !== false) {
    failures.push(`${item.name}: same-version registry artifact must be recorded as distinct`);
  }
  if (packageJson.dependencies?.[item.name] !== `file:vendor/${item.file}`) {
    failures.push(`${item.name}: package.json must reference ${item.file}`);
  }

  try {
    const bytes = await readFile(resolve(vendorRoot, item.file));
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== item.sha256) {
      failures.push(`${item.file}: expected ${item.sha256}, got ${actual}`);
    }
  } catch (error) {
    failures.push(`${item.file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

for (const entry of await readdir(vendorRoot, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.tgz') && !expectedTarballs.has(entry.name)) {
    failures.push(`${entry.name}: unrecorded tarball`);
  }
}

if (failures.length > 0) {
  console.error(`Vendored platform integrity failures:\n${failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.warn(
    `Verified ${manifest.packages.length} frozen workspace snapshots from ${manifest.source.commit}`
  );
}
