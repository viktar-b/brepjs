import { fileURLToPath } from 'node:url';
import { isRunnableDevEnvironment, normalizePath, type ViteDevServer } from 'vite';
import type { AuthoredSnapshot, BackendResult } from './workbenchRuntime.js';

interface AuthoredEvaluationModule {
  readonly evaluateAuthoredSnapshot: () => Promise<BackendResult<AuthoredSnapshot>>;
}

const AUTHORED_EVALUATION_ENTRY = normalizePath(
  fileURLToPath(new URL('./evaluateAuthored.ts', import.meta.url))
);

/** Load the authored evaluator exclusively through Vite's current SSR module runner. */
export function createSsrAuthoredLoader(
  server: ViteDevServer
): () => Promise<BackendResult<AuthoredSnapshot>> {
  return async () => {
    const environment = server.environments.ssr;
    if (!isRunnableDevEnvironment(environment)) {
      return {
        ok: false,
        error: {
          stage: 'configuration',
          code: 'SSR_ENVIRONMENT_NOT_RUNNABLE',
          message: 'The Vite SSR environment cannot evaluate the authored Model',
          context: {},
          retryable: false,
          action: 'Run the workbench with its programmatic Vite development server',
        },
      };
    }

    try {
      const authored =
        await environment.runner.import<AuthoredEvaluationModule>(AUTHORED_EVALUATION_ENTRY);
      return await authored.evaluateAuthoredSnapshot();
    } catch (cause) {
      return {
        ok: false,
        error: {
          stage: 'authored-evaluation',
          code: 'AUTHORED_MODULE_LOAD_FAILED',
          message:
            cause instanceof Error
              ? cause.message
              : 'Vite could not load the authored Model evaluator',
          context: {},
          retryable: true,
          action: 'Inspect the terminal and repair the latest infra-bridge TSX edit',
        },
      };
    }
  };
}

/** Invalidate the SSR graph so the runner imports a fresh authored snapshot next time. */
export function invalidateSsrAuthoredModules(server: ViteDevServer): void {
  const environment = server.environments.ssr;
  environment.moduleGraph.invalidateAll();
}
