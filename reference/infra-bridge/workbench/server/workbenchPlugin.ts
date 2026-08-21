import type { IncomingMessage, ServerResponse } from 'node:http';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePath, type Plugin, type ViteDevServer } from 'vite';
import {
  SOURCE_INVALIDATED_EVENT,
  WORKBENCH_API,
  type SourceInvalidatedPayload,
  type WorkbenchDiagnosticError,
  type WorkbenchResult,
} from '../shared/protocol.js';
import type { WorkbenchRuntime } from './workbenchRuntime.js';
import { invalidateSsrAuthoredModules } from './ssrAuthoredLoader.js';

export const SOURCE_INVALIDATION_DEBOUNCE_MS = 150;

export type WorkbenchErrorLogger = (cause: unknown) => void | Promise<void>;

const DEFAULT_AUTHORED_SOURCE_ROOT = fileURLToPath(
  new URL('../../../../examples/infra-bridge/src/', import.meta.url)
);
export interface WorkbenchPluginOptions {
  readonly runtime: () => WorkbenchRuntime;
  readonly logError?: WorkbenchErrorLogger | undefined;
  readonly authoredSourceRoot?: string | undefined;
  readonly invalidationDebounceMs?: number | undefined;
}

/** Serve the diagnostic API and bridge authored-file HMR into runtime revisions. */
export function createWorkbenchPlugin(options: WorkbenchPluginOptions): Plugin {
  const sourceRoot = resolve(options.authoredSourceRoot ?? DEFAULT_AUTHORED_SOURCE_ROOT);
  const debounceMs = options.invalidationDebounceMs ?? SOURCE_INVALIDATION_DEBOUNCE_MS;
  const logError = options.logError ?? logErrorToStderr;
  let server: ViteDevServer | undefined;
  let notification: ReturnType<typeof setTimeout> | undefined;
  let newestRevision = 0;

  function scheduleInvalidationEvent(revision: number): void {
    newestRevision = revision;
    if (notification !== undefined) clearTimeout(notification);
    notification = setTimeout(() => {
      notification = undefined;
      const payload: SourceInvalidatedPayload = {
        revision: newestRevision,
      };
      server?.environments.client.hot.send(SOURCE_INVALIDATED_EVENT, payload);
    }, debounceMs);
  }

  return {
    name: 'brepjs-infra-workbench',
    configureServer(vite) {
      server = vite;
      vite.watcher.add(sourceRoot);
      vite.middlewares.use((request, response, next) => {
        if (!isApiRequest(request.url)) {
          next();
          return;
        }
        const runtime = options.runtime();
        void handleApiRequest(vite, runtime, request, response).catch(async (cause: unknown) => {
          await reportUnexpectedError(logError, cause);
          writeJson(
            response,
            500,
            failure(await currentRevision(runtime), {
              stage: 'configuration',
              code: 'WORKBENCH_SERVER_FAILURE',
              message:
                cause instanceof Error
                  ? cause.message
                  : 'The workbench request failed unexpectedly',
              context: {},
              retryable: true,
              action: 'Inspect the workbench terminal, then retry the request',
            })
          );
        });
      });
    },
    hotUpdate(update) {
      if (this.environment.name !== 'ssr' || !isAuthoredSourceFile(sourceRoot, update.file)) {
        return;
      }
      if (server === undefined) return [];

      invalidateSsrAuthoredModules(server);
      const revision = options.runtime().invalidateSource();
      scheduleInvalidationEvent(revision);
      return [];
    },
    closeBundle() {
      if (notification !== undefined) clearTimeout(notification);
      notification = undefined;
    },
  };
}

async function handleApiRequest(
  server: ViteDevServer,
  runtime: WorkbenchRuntime,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const url = new URL(request.url ?? WORKBENCH_API.catalog, 'http://workbench.local');
  if (url.pathname === WORKBENCH_API.catalog) {
    if (request.method !== 'GET') {
      await writeMethodNotAllowed(runtime, response, 'GET');
      return;
    }
    const result = await runtime.catalog();
    writeJson(response, statusFor(result), result);
    return;
  }

  if (url.pathname === WORKBENCH_API.overall) {
    if (request.method !== 'GET') {
      await writeMethodNotAllowed(runtime, response, 'GET');
      return;
    }
    const result = await runtime.overall();
    writeJson(response, statusFor(result), result);
    return;
  }

  if (url.pathname === WORKBENCH_API.overallRefresh) {
    if (request.method !== 'POST') {
      await writeMethodNotAllowed(runtime, response, 'POST');
      return;
    }
    invalidateSsrAuthoredModules(server);
    const result = await runtime.refreshOverall();
    writeJson(response, statusFor(result), result);
    return;
  }

  if (url.pathname === WORKBENCH_API.componentSource) {
    if (request.method !== 'GET') {
      await writeMethodNotAllowed(runtime, response, 'GET');
      return;
    }
    const semanticKey = await readSemanticKey(runtime, url, response);
    if (semanticKey === undefined) return;
    const result = await runtime.componentSource(semanticKey);
    writeJson(response, statusFor(result), result);
    return;
  }

  if (url.pathname === WORKBENCH_API.componentSourceRefresh) {
    if (request.method !== 'POST') {
      await writeMethodNotAllowed(runtime, response, 'POST');
      return;
    }
    const semanticKey = await readSemanticKey(runtime, url, response);
    if (semanticKey === undefined) return;
    invalidateSsrAuthoredModules(server);
    const result = await runtime.refreshComponentSource(semanticKey);
    writeJson(response, statusFor(result), result);
    return;
  }

  if (url.pathname === WORKBENCH_API.comparison) {
    if (request.method !== 'GET') {
      await writeMethodNotAllowed(runtime, response, 'GET');
      return;
    }
    const semanticKey = await readSemanticKey(runtime, url, response);
    if (semanticKey === undefined) return;
    const result = await runtime.comparison(semanticKey);
    writeJson(response, statusFor(result), result);
    return;
  }

  if (url.pathname === WORKBENCH_API.refresh) {
    if (request.method !== 'POST') {
      await writeMethodNotAllowed(runtime, response, 'POST');
      return;
    }
    const semanticKey = await readSemanticKey(runtime, url, response);
    if (semanticKey === undefined) return;
    invalidateSsrAuthoredModules(server);
    const result = await runtime.refresh(semanticKey);
    writeJson(response, statusFor(result), result);
    return;
  }

  const revision = await currentRevision(runtime);
  writeJson(
    response,
    404,
    failure(revision, {
      stage: 'configuration',
      code: 'API_ROUTE_NOT_FOUND',
      message: 'The requested workbench API route does not exist',
      context: { path: url.pathname },
      retryable: false,
      action: 'Use a catalog, overall, comparison, Component Source, or refresh route',
    })
  );
}

async function readSemanticKey(
  runtime: WorkbenchRuntime,
  url: URL,
  response: ServerResponse
): Promise<string | undefined> {
  const values = url.searchParams.getAll('semanticKey');
  const semanticKey = values[0];
  if (values.length === 1 && semanticKey !== undefined && isWellFormedKey(semanticKey)) {
    return semanticKey;
  }

  const missing = values.length === 0 || semanticKey === undefined || semanticKey.length === 0;
  const revision = await currentRevision(runtime);
  writeJson(
    response,
    400,
    failure(revision, {
      stage: 'configuration',
      code: missing ? 'MISSING_SEMANTIC_KEY' : 'INVALID_SEMANTIC_KEY_QUERY',
      message: missing
        ? 'The semanticKey query parameter is required'
        : 'The semanticKey query parameter must contain one exact Semantic Key',
      context: { parameterCount: values.length },
      retryable: false,
      action: 'Choose a product from the workbench catalog and retry the request',
    })
  );
  return undefined;
}

function isWellFormedKey(value: string): boolean {
  return value.length <= 2_048 && value.trim() === value && !value.includes('\0');
}

async function writeMethodNotAllowed(
  runtime: WorkbenchRuntime,
  response: ServerResponse,
  allowedMethod: 'GET' | 'POST'
): Promise<void> {
  response.setHeader('Allow', allowedMethod);
  writeJson(
    response,
    405,
    failure(await currentRevision(runtime), {
      stage: 'configuration',
      code: 'METHOD_NOT_ALLOWED',
      message: `This workbench route requires ${allowedMethod}`,
      context: { allowedMethod },
      retryable: false,
      action: `Retry the request with ${allowedMethod}`,
    })
  );
}

function statusFor(result: WorkbenchResult<unknown>): number {
  if (result.ok) return 200;
  if (result.error.code === 'UNKNOWN_SEMANTIC_KEY') return 404;
  if (result.error.stage === 'checksum') return 409;
  if (result.error.stage === 'reference-file') return 424;
  if (result.error.stage === 'configuration') return 400;
  return 422;
}

async function currentRevision(runtime: WorkbenchRuntime): Promise<number> {
  try {
    return (await runtime.catalog()).revision;
  } catch {
    return 0;
  }
}

function isApiRequest(rawUrl: string | undefined): boolean {
  if (rawUrl === undefined) return false;
  const path = rawUrl.split('?', 1)[0];
  return path === WORKBENCH_API.catalog || path?.startsWith(`${WORKBENCH_API.catalog}/`) === true;
}

function isAuthoredSourceFile(sourceRoot: string, file: string): boolean {
  const pathFromRoot = relative(sourceRoot, file);
  return (
    pathFromRoot !== '' &&
    pathFromRoot !== '..' &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !pathFromRoot.includes(`${sep}..${sep}`) &&
    /\.(?:ts|tsx)$/u.test(normalizePath(pathFromRoot))
  );
}

function failure<T>(revision: number, error: WorkbenchDiagnosticError): WorkbenchResult<T> {
  return { ok: false, revision, error };
}

function writeJson(
  response: ServerResponse,
  status: number,
  result: WorkbenchResult<unknown>
): void {
  if (response.headersSent || response.writableEnded) return;
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(result));
}

async function reportUnexpectedError(
  logError: WorkbenchErrorLogger,
  cause: unknown
): Promise<void> {
  try {
    await logError(cause);
  } catch (loggingCause) {
    tryLogErrorToStderr(loggingCause);
    tryLogErrorToStderr(cause);
  }
}

function tryLogErrorToStderr(cause: unknown): void {
  try {
    logErrorToStderr(cause);
  } catch {
    // Logging must never prevent the structured API response from completing.
  }
}

function logErrorToStderr(cause: unknown): void {
  const detail =
    cause instanceof Error ? (cause.stack ?? cause.message) : describeUnknownError(cause);
  process.stderr.write(`Infra-bridge workbench request failure\n${detail}\n`);
}

function describeUnknownError(cause: unknown): string {
  try {
    return String(cause);
  } catch {
    return 'Unknown workbench server failure';
  }
}
