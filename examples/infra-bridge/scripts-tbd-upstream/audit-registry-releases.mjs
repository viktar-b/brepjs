import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(projectRoot, 'vendor/manifest.json'), 'utf8'));
const drift = [];

for (const item of manifest.packages ?? []) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(item.name)}`);
  if (!response.ok) throw new Error(`${item.name}: registry returned HTTP ${response.status}`);
  const metadata = await response.json();
  const currentLatest = metadata['dist-tags']?.latest;
  const frozenLatest = item.registryAtFreeze?.latest;
  const currentLatestRelease = metadata.versions?.[currentLatest];

  if (
    currentLatest !== frozenLatest?.version ||
    currentLatestRelease?.gitHead !== frozenLatest?.gitHead ||
    currentLatestRelease?.dist?.integrity !== frozenLatest?.integrity
  ) {
    drift.push(
      `${item.name}: frozen latest ${frozenLatest?.version ?? 'missing'}, current latest ${currentLatest ?? 'missing'}`
    );
  }

  const sameVersion = item.registryAtFreeze?.sameVersionRelease;
  if (sameVersion !== null && sameVersion !== undefined) {
    const currentSameVersion = metadata.versions?.[item.sourcePackageVersion];
    if (currentSameVersion?.dist?.integrity !== sameVersion.integrity) {
      drift.push(`${item.name}@${item.sourcePackageVersion}: registry integrity changed`);
    } else {
      const tarballResponse = await fetch(currentSameVersion.dist.tarball);
      if (!tarballResponse.ok) {
        throw new Error(
          `${item.name}@${item.sourcePackageVersion}: registry returned HTTP ${tarballResponse.status}`
        );
      }
      const publicSha256 = createHash('sha256')
        .update(new Uint8Array(await tarballResponse.arrayBuffer()))
        .digest('hex');
      if (publicSha256 !== sameVersion.sha256) {
        drift.push(`${item.name}@${item.sourcePackageVersion}: registry artifact bytes changed`);
      }
    }
  }

  console.warn(
    `${item.name}: frozen workspace ${item.sourcePackageVersion}, registry latest ${String(currentLatest)}`
  );
}

if (drift.length > 0) {
  console.error(`Registry release drift:\n${drift.join('\n')}`);
  process.exitCode = 1;
} else {
  console.warn(`Registry release freeze remains current as of ${manifest.freeze.capturedAt}`);
}
