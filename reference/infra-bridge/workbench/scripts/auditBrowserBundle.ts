import { readFile, readdir } from 'node:fs/promises';
import { auditBrowserAssets } from './browserBuildBoundary.js';

const dist = new URL('../dist/', import.meta.url);
const forbidden = [
  'web-ifc',
  'occt-wasm',
  'brepjs-bim',
  'brepjs-families',
  'examples/infra-bridge',
  'evaluateAuthoredSnapshot',
  'createWorkbenchRuntime',
  '@shikijs',
] as const;

const emittedFiles = await filesBelow(dist);
auditBrowserAssets(
  await Promise.all(
    emittedFiles.map(async (file) => ({
      fileName: file.pathname.slice(dist.pathname.length),
      type: file.pathname.endsWith('.js') ? ('chunk' as const) : ('asset' as const),
      source: file.pathname.endsWith('.js') ? await readFile(file, 'utf8') : undefined,
    }))
  )
);
const files = emittedFiles.filter((file) => file.pathname.endsWith('.js'));
if (files.length === 0) throw new Error('Workbench build emitted no JavaScript bundle');
for (const file of files) {
  const source = await readFile(file, 'utf8');
  const leaked = forbidden.filter((token) => source.includes(token));
  if (leaked.length > 0) {
    throw new Error(
      `Browser bundle ${file.pathname} contains server/kernel tokens: ${leaked.join(', ')}`
    );
  }
}
process.stdout.write(
  `Browser boundary audit passed (${String(files.length)} JavaScript bundle).\n`
);

async function filesBelow(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const url = new URL(entry.name, directory);
      if (entry.isDirectory()) return filesBelow(new URL(`${entry.name}/`, directory));
      return [url];
    })
  );
  return nested.flat();
}
