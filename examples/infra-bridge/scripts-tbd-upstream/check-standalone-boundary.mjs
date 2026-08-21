import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inspectedFiles = ['package.json', 'eslint.config.js', 'tsconfig.typecheck.json'];
const requiredFiles = [
  '.github/workflows/ci.yml',
  '.gitignore',
  '.npmrc',
  '.nvmrc',
  'AGENTS.md',
  'LICENSE',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'baselines/infra-bridge.ifc.json',
  'package-lock.json',
  'scripts-tbd-upstream/audit-registry-releases.mjs',
  'scripts-tbd-upstream/refresh-package-lock.mjs',
  'tsconfig.build.json',
  'vendor/manifest.json',
];
const violations = [];

for (const relativePath of inspectedFiles) {
  const source = await readFile(resolve(projectRoot, relativePath), 'utf8');
  if (source.includes('../..')) violations.push(`${relativePath}: parent-relative dependency`);
}

for (const relativePath of requiredFiles) {
  try {
    await access(resolve(projectRoot, relativePath));
  } catch {
    violations.push(`${relativePath}: required standalone file is missing`);
  }
}

const packageJson = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8'));
const allDependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
for (const [name, version] of Object.entries(allDependencies)) {
  if (typeof version !== 'string' || version === '*' || /^[~^]/u.test(version)) {
    violations.push(`package.json: ${name} must use an exact or vendored version`);
  }
}

for (const name of ['brepjs', 'brepjs-bim', 'brepjs-families']) {
  if (!packageJson.dependencies?.[name]?.startsWith('file:vendor/')) {
    violations.push(`package.json: ${name} must resolve from vendor/`);
  }
}

if (Object.keys(packageJson.exports ?? {}).join(',') !== '.') {
  violations.push('package.json: only the narrow root package Interface may be exported');
}

if (packageJson.scripts?.['reference:compare'] !== undefined) {
  violations.push('package.json: reference comparison must remain an external workflow');
}

if (violations.length > 0) {
  console.error(`Standalone boundary violations:\n${violations.join('\n')}`);
  process.exitCode = 1;
} else {
  console.warn('Standalone boundary check passed');
}
