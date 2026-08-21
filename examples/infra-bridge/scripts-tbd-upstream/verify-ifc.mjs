import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = resolve(projectRoot, 'baselines/infra-bridge.ifc.json');
const outputPath = resolve(projectRoot, 'dist/infra-bridge.ifc');
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));

function exportIfc() {
  const result = spawnSync('npm', ['run', 'export:ifc'], {
    cwd: projectRoot,
    env: { ...process.env, SOURCE_DATE_EPOCH: String(baseline.sourceDateEpoch) },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`IFC export failed with exit code ${String(result.status)}`);
  }
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

await rm(outputPath, { force: true });
exportIfc();
const first = await readFile(outputPath);

await rm(outputPath, { force: true });
exportIfc();
const second = await readFile(outputPath);

const firstHash = digest(first);
const secondHash = digest(second);
const failures = [];
if (!first.equals(second)) failures.push(`repeat export changed: ${firstHash} != ${secondHash}`);
if (second.length !== baseline.bytes) {
  failures.push(
    `byte length changed: expected ${String(baseline.bytes)}, got ${String(second.length)}`
  );
}
if (secondHash !== baseline.sha256) {
  failures.push(`SHA-256 changed: expected ${baseline.sha256}, got ${secondHash}`);
}

if (failures.length > 0) {
  console.error(`IFC reproducibility failures:\n${failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.warn(`Verified deterministic IFC: ${String(second.length)} bytes, SHA-256 ${secondHash}`);
}
