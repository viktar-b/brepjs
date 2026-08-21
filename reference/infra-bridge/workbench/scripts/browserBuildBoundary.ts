import { relative, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

const FORBIDDEN_PACKAGE_ROOTS = [
  'web-ifc',
  'occt-wasm',
  'brepjs',
  'brepjs-bim',
  'brepjs-families',
  'shiki',
  '@shikijs',
] as const;

const FORBIDDEN_REPOSITORY_ROOTS = [
  'src',
  'dist',
  'packages/brepjs-bim',
  'packages/brepjs-families',
  'examples/infra-bridge',
  'reference/infra-bridge/node',
  'reference/infra-bridge/scripts',
  'reference/infra-bridge/src',
  'reference/infra-bridge/workbench/server',
] as const;

export interface ForbiddenBrowserModule {
  readonly moduleId: string;
  readonly reason: string;
}

export interface BrowserAsset {
  readonly fileName: string;
  readonly type: 'asset' | 'chunk';
  readonly facadeModuleId?: string | null | undefined;
  readonly source?: string | undefined;
}

/**
 * Returns every browser-graph module that crosses the workbench's Node/kernel boundary.
 *
 * This accepts resolved module IDs, so it catches package imports after Vite aliases and
 * transitive dependencies have erased the original import spelling.
 */
export function findForbiddenBrowserModules(
  moduleIds: Iterable<string>,
  repositoryRoot: string
): ForbiddenBrowserModule[] {
  const root = normalizePath(resolve(repositoryRoot));
  const forbiddenRoots = FORBIDDEN_REPOSITORY_ROOTS.map((entry) =>
    normalizePath(resolve(root, entry))
  );
  const findings: ForbiddenBrowserModule[] = [];
  const visited = new Set<string>();

  for (const originalId of moduleIds) {
    if (visited.has(originalId)) continue;
    visited.add(originalId);
    if (/[?&](?:shared)?worker(?:_file)?(?:[=&]|$)/u.test(originalId)) {
      findings.push({ moduleId: originalId, reason: 'browser worker module' });
      continue;
    }
    const moduleId = normalizeModuleId(originalId);
    const rawPackage = FORBIDDEN_PACKAGE_ROOTS.find(
      (packageRoot) => moduleId === packageRoot || moduleId.startsWith(`${packageRoot}/`)
    );
    if (rawPackage !== undefined) {
      findings.push({ moduleId: originalId, reason: `forbidden package ${rawPackage}` });
      continue;
    }
    if (moduleId.startsWith('node:')) {
      findings.push({ moduleId: originalId, reason: 'Node builtin' });
      continue;
    }

    const installedPackage = FORBIDDEN_PACKAGE_ROOTS.find((packageRoot) =>
      moduleId.includes(`/node_modules/${packageRoot}/`)
    );
    if (installedPackage !== undefined) {
      findings.push({
        moduleId: originalId,
        reason: `resolved forbidden package ${installedPackage}`,
      });
      continue;
    }

    const workspaceRoot = forbiddenRoots.find((candidate) => isWithin(moduleId, candidate));
    if (workspaceRoot !== undefined) {
      findings.push({
        moduleId: originalId,
        reason: `forbidden repository root ${relative(root, workspaceRoot)}`,
      });
    }
  }
  return findings;
}

/** Rejects browser build assets that could initialize a kernel outside the Node backend. */
export function auditBrowserAssets(assets: Iterable<BrowserAsset>): void {
  const findings: string[] = [];
  for (const asset of assets) {
    const fileName = asset.fileName.toLocaleLowerCase();
    if (/\.wasm(?:$|[?#])/u.test(fileName)) {
      findings.push(`${asset.fileName} is a WebAssembly asset`);
    }
    if (
      asset.type === 'chunk' &&
      (/(?:^|[._/-])worker(?:[._/-]|$)/u.test(fileName) ||
        /[?&](?:shared)?worker(?:&|$)/u.test(asset.facadeModuleId ?? ''))
    ) {
      findings.push(`${asset.fileName} is a worker asset`);
    }
    if (asset.source !== undefined && /\b(?:Shared)?Worker\s*\(/u.test(asset.source)) {
      findings.push(`${asset.fileName} initializes a browser worker`);
    }
    if (
      asset.source !== undefined &&
      (/\bWebAssembly(?:\.|\[)/u.test(asset.source) || /\.wasm\b/u.test(asset.source))
    ) {
      findings.push(`${asset.fileName} initializes or embeds WebAssembly`);
    }
  }
  if (findings.length > 0) {
    throw new Error(`Browser build emitted forbidden assets:\n${findings.join('\n')}`);
  }
}

/** Creates the production-build guard for the JSON-only workbench browser. */
export function browserBuildBoundaryPlugin(repositoryRoot: string): Plugin {
  const parsedModuleIds = new Set<string>();
  return {
    name: 'infra-bridge-browser-build-boundary',
    apply: 'build',
    moduleParsed(moduleInfo) {
      parsedModuleIds.add(moduleInfo.id);
    },
    generateBundle(_options, bundle) {
      const moduleIds = new Set([...parsedModuleIds, ...this.getModuleIds()]);
      for (const emitted of Object.values(bundle)) {
        if (emitted.type === 'chunk') {
          for (const moduleId of emitted.moduleIds) moduleIds.add(moduleId);
        }
      }
      const forbidden = findForbiddenBrowserModules(moduleIds, repositoryRoot);
      if (forbidden.length > 0) {
        throw new Error(
          `Browser module graph crosses the Node/kernel boundary:\n${forbidden
            .map(({ moduleId, reason }) => `${reason}: ${moduleId}`)
            .join('\n')}`
        );
      }
      auditBrowserAssets(
        Object.values(bundle).map((emitted) => ({
          fileName: emitted.fileName,
          type: emitted.type,
          facadeModuleId: emitted.type === 'chunk' ? emitted.facadeModuleId : undefined,
          source:
            emitted.type === 'chunk'
              ? emitted.code
              : typeof emitted.source === 'string'
                ? emitted.source
                : undefined,
        }))
      );
    },
  };
}

function normalizeModuleId(moduleId: string): string {
  return normalizePath(
    moduleId
      .replace(/^\0/u, '')
      .replace(/^\/@fs\//u, '/')
      .split(/[?#]/u, 1)[0] ?? moduleId
  );
}

function normalizePath(path: string): string {
  return sep === '/' ? path : path.replaceAll(sep, '/');
}

function isWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}
