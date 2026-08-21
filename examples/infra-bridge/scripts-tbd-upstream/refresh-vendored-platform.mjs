import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendorRoot = resolve(projectRoot, 'vendor');
const cacheRoot = resolve(projectRoot, '.cache');
const npmCache = resolve(cacheRoot, 'npm');
const requestedRoot = process.argv[2];
const platformRoot = resolve(projectRoot, requestedRoot ?? '../..');
const packageRoots = [
  platformRoot,
  resolve(platformRoot, 'packages/brepjs-families'),
  resolve(platformRoot, 'packages/brepjs-bim'),
];

const commitResult = spawnSync('git', ['-C', platformRoot, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
});
if (commitResult.status !== 0) {
  throw new Error(`Cannot identify platform commit: ${commitResult.stderr}`);
}
const commit = commitResult.stdout.trim();
const shortCommit = commit.slice(0, 12);
const capturedAt = new Date().toISOString();

await mkdir(vendorRoot, { recursive: true });
await mkdir(cacheRoot, { recursive: true });
const stagingRoot = await mkdtemp(resolve(cacheRoot, 'vendor-refresh-'));

try {
  const packages = [];
  const stagedPaths = new Map();
  for (const packageRoot of packageRoots) {
    const packed = spawnSync(
      'npm',
      ['pack', packageRoot, '--ignore-scripts', '--json', '--pack-destination', stagingRoot],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: { ...process.env, npm_config_cache: npmCache },
      }
    );
    if (packed.status !== 0) {
      throw new Error(`npm pack failed for ${packageRoot}:\n${packed.stdout}${packed.stderr}`);
    }
    const report = JSON.parse(packed.stdout);
    const item = report[0];
    if (
      item === undefined ||
      typeof item.filename !== 'string' ||
      typeof item.name !== 'string' ||
      typeof item.version !== 'string'
    ) {
      throw new Error(`npm pack returned no artifact for ${packageRoot}`);
    }

    const stagedPath = resolve(stagingRoot, item.filename);
    const bytes = await readFile(stagedPath);
    const sha256 = digest(bytes);
    const safeName = item.name.replace(/^@/u, '').replaceAll('/', '-');
    const file = `${safeName}-${item.version}-workspace-snapshot-${shortCommit}.tgz`;
    packages.push({
      name: item.name,
      artifactKind: 'workspace-snapshot',
      sourcePackageVersion: item.version,
      file,
      sha256,
      registryAtFreeze: await captureRegistryState(item.name, item.version, sha256),
    });
    stagedPaths.set(file, stagedPath);
  }

  const manifest = {
    schemaVersion: 2,
    freeze: {
      status: 'frozen',
      capturedAt,
      policy:
        'Compatibility snapshots are immutable and are not automatically replaced by registry latest.',
    },
    source: {
      repository: 'https://github.com/andymai/brepjs',
      commit,
    },
    packages,
  };

  for (const item of packages) {
    const destination = resolve(vendorRoot, item.file);
    const pendingDestination = `${destination}.next`;
    const stagedPath = stagedPaths.get(item.file);
    if (stagedPath === undefined) throw new Error(`Missing staged artifact for ${item.file}`);
    await copyFile(stagedPath, pendingDestination);
    await rename(pendingDestination, destination);
  }

  const pendingManifest = resolve(vendorRoot, 'manifest.json.next');
  await writeFile(pendingManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(pendingManifest, resolve(vendorRoot, 'manifest.json'));

  const expectedFiles = new Set(packages.map((item) => item.file));
  for (const entry of await readdir(vendorRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.tgz') && !expectedFiles.has(entry.name)) {
      await rm(resolve(vendorRoot, entry.name));
    }
  }

  console.warn(`Froze ${packages.length} workspace snapshots from ${commit}`);
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}

async function captureRegistryState(name, sourcePackageVersion, snapshotSha256) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
  if (!response.ok) {
    throw new Error(`Registry metadata request failed for ${name}: HTTP ${response.status}`);
  }
  const metadata = await response.json();
  const latestVersion = metadata['dist-tags']?.latest;
  if (typeof latestVersion !== 'string') {
    throw new Error(`Registry metadata for ${name} has no latest dist-tag`);
  }

  const latestRelease = releaseRecord(metadata, latestVersion);
  const sameVersionMetadata = metadata.versions?.[sourcePackageVersion];
  let sameVersionRelease = null;
  if (sameVersionMetadata !== undefined) {
    const tarballResponse = await fetch(sameVersionMetadata.dist?.tarball);
    if (!tarballResponse.ok) {
      throw new Error(
        `Registry artifact request failed for ${name}@${sourcePackageVersion}: HTTP ${tarballResponse.status}`
      );
    }
    const publicBytes = new Uint8Array(await tarballResponse.arrayBuffer());
    const publicSha256 = digest(publicBytes);
    sameVersionRelease = {
      ...releaseRecord(metadata, sourcePackageVersion),
      sha256: publicSha256,
      matchesSnapshot: publicSha256 === snapshotSha256,
    };
  }

  return { latest: latestRelease, sameVersionRelease };
}

function releaseRecord(metadata, version) {
  const release = metadata.versions?.[version];
  if (release === undefined) {
    throw new Error(`Registry metadata has no release record for ${metadata.name}@${version}`);
  }
  return {
    version,
    publishedAt: metadata.time?.[version],
    gitHead: release.gitHead,
    integrity: release.dist?.integrity,
  };
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
