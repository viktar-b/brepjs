import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
if (nodeMajor < 24) throw new Error(`Node 24 or newer is required; found ${process.version}`);

const temporaryParent = await mkdtemp(resolve(tmpdir(), 'infra-bridge-standalone-'));
const isolatedRoot = resolve(temporaryParent, basename(projectRoot));
const excluded = new Set(['.cache', 'coverage', 'dist', 'lib', 'node_modules']);
let succeeded = false;

function run(command, args, extraEnv = {}) {
  console.warn(`> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: isolatedRoot,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${String(result.status)}`);
  }
}

try {
  await cp(projectRoot, isolatedRoot, {
    recursive: true,
    filter(source) {
      return !excluded.has(basename(source));
    },
  });

  run('node', ['scripts-tbd-upstream/check-standalone-boundary.mjs']);
  run('node', ['scripts-tbd-upstream/verify-vendored-platform.mjs']);
  run('npm', ['ci'], { npm_config_cache: resolve(isolatedRoot, '.cache/npm') });
  run('npm', ['run', 'check']);
  run('npm', ['run', 'preview']);
  run('npm', ['run', 'verify:ifc']);
  succeeded = true;
  console.warn(`Standalone verification passed in ${isolatedRoot}`);
} finally {
  if (succeeded && process.env.KEEP_STANDALONE_TMP !== '1') {
    await rm(temporaryParent, { recursive: true, force: true });
  } else {
    console.warn(`Standalone verification directory retained at ${isolatedRoot}`);
  }
}
