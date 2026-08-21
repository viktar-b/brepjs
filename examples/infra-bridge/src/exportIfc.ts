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
const outputBytes = applySourceDateEpoch(exported.bytes);

const here = dirname(fileURLToPath(import.meta.url));
const output = resolvePath(here, '../dist/infra-bridge.ifc');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, outputBytes);
console.warn(`Wrote ${output} (${outputBytes.byteLength} bytes)`);

function applySourceDateEpoch(bytes: Uint8Array): Uint8Array {
  const sourceDateEpoch = process.env['SOURCE_DATE_EPOCH'];
  if (sourceDateEpoch === undefined) return bytes;
  const epochSeconds = Number(sourceDateEpoch);
  if (!Number.isSafeInteger(epochSeconds) || epochSeconds < 0) {
    throw new Error('SOURCE_DATE_EPOCH must be a non-negative integer number of seconds');
  }
  const timestamp = new Date(epochSeconds * 1_000).toISOString().slice(0, 19);
  const text = new TextDecoder().decode(bytes);
  const fileNameTimestamp = /(FILE_NAME\('[^']*',')[^']*(')/u;
  if (!fileNameTimestamp.test(text)) {
    throw new Error('Cannot normalize SOURCE_DATE_EPOCH: IFC FILE_NAME header not found');
  }
  return new TextEncoder().encode(text.replace(fileNameTimestamp, `$1${timestamp}$2`));
}
