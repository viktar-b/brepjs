import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { startWorkbench } from './startWorkbench.js';

export interface WorkbenchArguments {
  readonly ifcPath: string;
  readonly host: string;
  readonly port: number;
}

/** Parse the workbench-only flags before Vite sees the command line. */
export function parseWorkbenchArguments(args: readonly string[], cwd: string): WorkbenchArguments {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      ifc: { type: 'string' },
      host: { type: 'string', default: '127.0.0.1' },
      port: { type: 'string', default: '5173' },
    },
  });
  if (values.ifc === undefined || values.ifc.trim().length === 0) {
    throw new Error('--ifc is required and must name the checksummed IFC4X3 Reference');
  }
  if (values.host.trim().length === 0) {
    throw new Error('--host must be a non-empty hostname or IP address');
  }
  if (
    !/^\d+$/u.test(values.port) ||
    !Number.isInteger(Number(values.port)) ||
    Number(values.port) > 65_535
  ) {
    throw new Error('--port must be an integer between 0 and 65535');
  }

  return {
    ifcPath: resolve(cwd, values.ifc),
    host: values.host,
    port: Number(values.port),
  };
}

async function main(): Promise<void> {
  const options = parseWorkbenchArguments(process.argv.slice(2), process.cwd());
  const started = await startWorkbench(options);
  let closing: Promise<void> | undefined;

  const shutdown = (): void => {
    closing ??= started
      .close()
      .catch((cause: unknown) => {
        console.error(cause instanceof Error ? cause.message : cause);
        process.exitCode = 1;
      })
      .finally(() => {
        process.off('SIGINT', shutdown);
        process.off('SIGTERM', shutdown);
      });
    void closing;
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

const entryPath = process.argv[1];
if (entryPath !== undefined && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  void main().catch((cause: unknown) => {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
  });
}
