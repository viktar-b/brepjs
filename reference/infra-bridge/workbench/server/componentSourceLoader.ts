import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHighlighter, type ShikiTransformer } from 'shiki';
import type { ComponentSourceFile, WorkbenchDiagnosticError } from '../shared/protocol.js';
import type { BackendResult } from './workbenchRuntime.js';

export interface ComponentSourceDescriptor {
  readonly definitionName: string;
  readonly fileName: string;
  readonly path: `examples/infra-bridge/src/families/${string}.tsx`;
}

export interface LoadedComponentSource {
  readonly definitionName: string;
  readonly source: ComponentSourceFile;
}

export interface ComponentSourceLoader {
  load(request: {
    readonly semanticKey: string;
    readonly definitionName: string;
  }): Promise<BackendResult<LoadedComponentSource>>;
}

export interface ComponentSourceLoaderOptions {
  readonly sourceRoot?: string | undefined;
  readonly readSource?: ((absolutePath: string) => Promise<string>) | undefined;
}

const DEFAULT_SOURCE_ROOT = fileURLToPath(
  new URL('../../../../examples/infra-bridge/', import.meta.url)
);

const SOURCE_DESCRIPTORS = [
  descriptor('AbutmentSupportBeam', 'abutmentSupportBeam.tsx'),
  descriptor('ApproachSlab', 'approachSlab.tsx'),
  descriptor('ArchSegment', 'archSegment.tsx'),
  descriptor('BridgeDeck', 'bridgeDeck.tsx'),
  descriptor('BridgeNameSign', 'bridgeNameSign.tsx'),
  descriptor('CrossGirder', 'crossGirder.tsx'),
  descriptor('EarthFill', 'earthFill.tsx'),
  descriptor('Footing', 'footing.tsx'),
  descriptor('MainGirder', 'mainGirder.tsx'),
  descriptor('PierStem', 'pierStem.tsx'),
  descriptor('RailPierStem', 'railPierStem.tsx'),
  descriptor('RoadRailing', 'roadRailing.tsx'),
  descriptor('SpandrelWall', 'spandrelWall.tsx'),
] as const satisfies readonly ComponentSourceDescriptor[];

const SOURCE_BY_DEFINITION = new Map(
  SOURCE_DESCRIPTORS.map((entry) => [entry.definitionName, entry] as const)
);

let highlighterPromise: ReturnType<typeof createHighlighter> | undefined;

/** Return the closed server-owned Family source allow-list. */
export function componentSourceDescriptors(): readonly ComponentSourceDescriptor[] {
  return SOURCE_DESCRIPTORS;
}

/** Create a server-only reader for approved infra-bridge Family TSX source. */
export function createComponentSourceLoader(
  options: ComponentSourceLoaderOptions = {}
): ComponentSourceLoader {
  const sourceRoot = resolve(options.sourceRoot ?? DEFAULT_SOURCE_ROOT);
  const readSource = options.readSource ?? ((path: string) => readFile(path, 'utf8'));

  return {
    async load({ semanticKey, definitionName }) {
      const source = SOURCE_BY_DEFINITION.get(definitionName);
      if (source === undefined) {
        return sourceFailure({
          stage: 'source-file',
          code: 'COMPONENT_SOURCE_UNMAPPED',
          message: `No approved Family source is mapped for definition '${definitionName}'`,
          context: { semanticKey, definitionName },
          retryable: false,
          action: 'Add the Family definition to the server-owned Component Source allow-list',
        });
      }

      const relativeToExample = source.path.replace(/^examples\/infra-bridge\//u, '');
      const absolutePath = resolve(sourceRoot, relativeToExample);
      if (!isWithin(absolutePath, sourceRoot) || !absolutePath.endsWith('.tsx')) {
        return sourceFailure({
          stage: 'source-file',
          code: 'COMPONENT_SOURCE_PATH_REJECTED',
          message: 'The approved Family source path escaped the authored example source root',
          context: { semanticKey, definitionName, path: source.path },
          retryable: false,
          action: 'Correct the server-owned Component Source allow-list entry',
        });
      }

      let text: string;
      try {
        text = await readSource(absolutePath);
      } catch {
        return sourceFailure({
          stage: 'source-file',
          code: 'COMPONENT_SOURCE_READ_FAILED',
          message: `The approved Family source '${source.path}' could not be read`,
          context: { semanticKey, definitionName, path: source.path },
          retryable: true,
          action: 'Restore the Family TSX file at the approved repo-relative path, then retry',
        });
      }

      try {
        return {
          ok: true,
          value: {
            definitionName,
            source: {
              fileName: source.fileName,
              path: source.path,
              language: 'tsx',
              text,
              highlightedHtml: await highlightTsxSource(text),
            },
          },
        };
      } catch {
        return sourceFailure({
          stage: 'source-file',
          code: 'COMPONENT_SOURCE_HIGHLIGHT_FAILED',
          message: `The approved Family source '${source.path}' could not be highlighted`,
          context: { semanticKey, definitionName, path: source.path },
          retryable: true,
          action: 'Inspect the source syntax and workbench server log, then retry',
        });
      }
    },
  };
}

/** Highlight TSX with one process-wide highlighter and native Shiki line structure. */
export async function highlightTsxSource(source: string): Promise<string> {
  const highlighter = await getHighlighter();
  return highlighter.codeToHtml(source, {
    lang: 'tsx',
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
    transformers: [lineNumberTransformer],
  });
}

const lineNumberTransformer: ShikiTransformer = {
  name: 'infra-workbench-line-numbers',
  line(element, line) {
    element.properties['data-line'] = line;
  },
};

function getHighlighter(): ReturnType<typeof createHighlighter> {
  if (highlighterPromise === undefined) {
    const pending = createHighlighter({
      langs: ['tsx'],
      themes: ['github-light', 'github-dark'],
    });
    highlighterPromise = pending;
    void pending.catch(() => {
      if (highlighterPromise === pending) highlighterPromise = undefined;
    });
  }
  return highlighterPromise;
}

function descriptor(definitionName: string, fileName: `${string}.tsx`): ComponentSourceDescriptor {
  return {
    definitionName,
    fileName,
    path: `examples/infra-bridge/src/families/${fileName}`,
  };
}

function isWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

function sourceFailure(error: WorkbenchDiagnosticError): BackendResult<never> {
  return { ok: false, error };
}
