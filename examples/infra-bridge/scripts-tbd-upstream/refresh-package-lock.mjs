import { spawnSync } from 'node:child_process';
import { copyFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporaryParent = await mkdtemp(resolve(tmpdir(), 'infra-bridge-lock-'));
const isolatedRoot = resolve(temporaryParent, basename(projectRoot));
const excluded = new Set(['.cache', 'coverage', 'dist', 'lib', 'node_modules']);
let succeeded = false;

try {
  await cp(projectRoot, isolatedRoot, {
    recursive: true,
    filter(source) {
      return !excluded.has(basename(source));
    },
  });

  const result = spawnSync(
    'npm',
    ['install', '--package-lock-only', '--ignore-scripts', '--cache', '.cache/npm'],
    {
      cwd: isolatedRoot,
      stdio: 'inherit',
    }
  );
  if (result.status !== 0) {
    throw new Error(`npm lockfile refresh failed with exit code ${String(result.status)}`);
  }

  await copyFile(
    resolve(isolatedRoot, 'package-lock.json'),
    resolve(projectRoot, 'package-lock.json')
  );
  succeeded = true;
  console.warn('Refreshed package-lock.json from an isolated project copy');
} finally {
  if (succeeded && process.env.KEEP_STANDALONE_TMP !== '1') {
    await rm(temporaryParent, { recursive: true, force: true });
  } else {
    console.warn(`Lockfile refresh directory retained at ${isolatedRoot}`);
  }
}
