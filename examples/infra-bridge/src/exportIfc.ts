import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { csg, unwrap } from 'brepjs';
import { hasErrors, toIfcValidated } from 'brepjs-bim';
import { evaluateModel, resolve } from 'brepjs-families';
import { buildInfraBridge } from './main.js';
import { projectInfraBridge } from './projectInfraBridge.js';

await import('brepjs/quick');

const root = resolve(await buildInfraBridge());
using evaluator = new csg.Evaluator();
const evaluatedModel = evaluateModel(root, evaluator);
const projected = unwrap(projectInfraBridge(root, evaluatedModel));
using bim = projected.model;
const exported = unwrap(
  await toIfcValidated(bim, {
    applicationName: 'brepjs declarative infra bridge',
    applicationVersion: '1',
    ifcSchema: 'IFC4X3',
  })
);
if (hasErrors(exported.report)) throw new Error('IFC validation failed');

const here = dirname(fileURLToPath(import.meta.url));
const output = resolvePath(here, '../dist/infra-bridge.ifc');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, exported.bytes);
console.warn(`Wrote ${output} (${exported.bytes.byteLength} bytes)`);
