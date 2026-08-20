import { resolve } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { createWorkbenchViteConfig } from '../vite.config.js';
import { createConfiguredRuntime } from './createRuntime.js';
import { createSsrAuthoredLoader } from './ssrAuthoredLoader.js';
import { createWorkbenchPlugin, type WorkbenchErrorLogger } from './workbenchPlugin.js';
import type { WorkbenchRuntime } from './workbenchRuntime.js';

export interface StartWorkbenchOptions {
  readonly ifcPath: string;
  readonly host?: string | undefined;
  readonly port?: number | undefined;
  readonly runtime?: WorkbenchRuntime | undefined;
  readonly log?: ((message: string) => unknown) | undefined;
  readonly logError?: WorkbenchErrorLogger | undefined;
  readonly authoredSourceRoot?: string | undefined;
  readonly invalidationDebounceMs?: number | undefined;
}

export interface StartedWorkbench {
  readonly server: ViteDevServer;
  readonly runtime: WorkbenchRuntime;
  readonly host: string;
  readonly port: number;
  readonly url: string;
  readonly close: () => Promise<void>;
}

/** Start the owned Vite workbench and return its actual URL plus an idempotent closer. */
export async function startWorkbench(options: StartWorkbenchOptions): Promise<StartedWorkbench> {
  const host = options.host ?? '127.0.0.1';
  const requestedPort = options.port ?? 5_173;
  let runtime = options.runtime;
  const plugin = createWorkbenchPlugin({
    runtime: () => {
      if (runtime === undefined) throw new Error('Workbench runtime is not ready');
      return runtime;
    },
    authoredSourceRoot: options.authoredSourceRoot,
    invalidationDebounceMs: options.invalidationDebounceMs,
    logError: options.logError,
  });
  const baseConfig = createWorkbenchViteConfig();
  const server = await createServer({
    ...baseConfig,
    configFile: false,
    clearScreen: false,
    logLevel: 'error',
    plugins: [...(baseConfig.plugins ?? []), plugin],
    server: {
      ...baseConfig.server,
      host,
      port: requestedPort,
      strictPort: requestedPort !== 0,
    },
  });

  try {
    runtime ??= await createConfiguredRuntime({
      ifcPath: resolve(options.ifcPath),
      evaluateAuthored: createSsrAuthoredLoader(server),
    });
    await server.listen();
  } catch (cause) {
    await server.close();
    throw cause;
  }

  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === 'string') {
    await server.close();
    throw new Error('Vite did not expose a TCP listening address');
  }
  const port = address.port;
  const url = `http://${urlHost(host)}:${port.toString()}/`;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= server.close();
    return closing;
  };
  try {
    await (options.log ?? logToStdout)(`Infra-bridge workbench: ${url}`);
  } catch (cause) {
    await close();
    throw cause;
  }

  return { server, runtime, host, port, url, close };
}

function urlHost(host: string): string {
  if (host === '0.0.0.0') return '127.0.0.1';
  if (host === '::') return '[::1]';
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function logToStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}
