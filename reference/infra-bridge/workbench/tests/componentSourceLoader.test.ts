import { describe, expect, it } from 'vitest';
import {
  componentSourceDescriptors,
  createComponentSourceLoader,
  highlightTsxSource,
} from '../server/componentSourceLoader.js';

const BRIDGE_DECK = 'infra-bridge/road-site/road-river-bridge/deck/bridge-deck';

describe('Component Source loader', () => {
  it('reads an explicitly allow-listed Family file and returns native dual-theme Shiki markup', async () => {
    const reads: string[] = [];
    const source = "const deck = 'bridge';\n\nexport { deck };\n";
    const loader = createComponentSourceLoader({
      sourceRoot: '/repo/examples/infra-bridge',
      readSource(path) {
        reads.push(path);
        return Promise.resolve(source);
      },
    });

    const result = await loader.load({
      semanticKey: BRIDGE_DECK,
      definitionName: 'BridgeDeck',
    });

    expect(reads).toEqual(['/repo/examples/infra-bridge/src/families/bridgeDeck.tsx']);
    expect(result).toMatchObject({
      ok: true,
      value: {
        definitionName: 'BridgeDeck',
        source: {
          fileName: 'bridgeDeck.tsx',
          path: 'examples/infra-bridge/src/families/bridgeDeck.tsx',
          language: 'tsx',
          text: source,
        },
      },
    });
    if (!result.ok) return;
    expect(result.value.source.highlightedHtml).toMatch(/^<pre[^>]*><code>/u);
    expect(result.value.source.highlightedHtml).toContain('--shiki-dark:');
    expect(result.value.source.highlightedHtml).toContain('class="line"');
    expect(result.value.source.highlightedHtml).toContain('data-line="2"');
    expect(result.value.source.highlightedHtml).toMatch(
      /data-line="1"[^>]*>.*deck.*<\/span>\n<span class="line" data-line="2"><\/span>/su
    );
  });

  it('uses one closed allow-list whose paths cannot escape the authored example or name non-TSX files', () => {
    const descriptors = componentSourceDescriptors();

    expect(descriptors.map(({ definitionName }) => definitionName)).toEqual([
      'AbutmentSupportBeam',
      'ApproachSlab',
      'ArchSegment',
      'BridgeDeck',
      'BridgeNameSign',
      'CrossGirder',
      'EarthFill',
      'Footing',
      'MainGirder',
      'PierStem',
      'RailPierStem',
      'RoadRailing',
      'SpandrelWall',
    ]);
    for (const descriptor of descriptors) {
      expect(descriptor.path).toMatch(/^examples\/infra-bridge\/src\/families\/[A-Za-z]+\.tsx$/u);
      expect(descriptor.path).not.toContain('..');
    }
  });

  it('rejects an unmapped definition without reading any path', async () => {
    let readCount = 0;
    const loader = createComponentSourceLoader({
      sourceRoot: '/repo/examples/infra-bridge',
      readSource() {
        readCount += 1;
        return Promise.resolve('');
      },
    });

    const result = await loader.load({ semanticKey: BRIDGE_DECK, definitionName: '../secret' });

    expect(readCount).toBe(0);
    expect(result).toEqual({
      ok: false,
      error: {
        stage: 'source-file',
        code: 'COMPONENT_SOURCE_UNMAPPED',
        message: "No approved Family source is mapped for definition '../secret'",
        context: { semanticKey: BRIDGE_DECK, definitionName: '../secret' },
        retryable: false,
        action: 'Add the Family definition to the server-owned Component Source allow-list',
      },
    });
  });

  it('reports source read failures with only the repo-relative approved path', async () => {
    const loader = createComponentSourceLoader({
      sourceRoot: '/private/repo/examples/infra-bridge',
      readSource() {
        return Promise.reject(new Error('EACCES /private/repo/examples/infra-bridge'));
      },
    });

    const result = await loader.load({ semanticKey: BRIDGE_DECK, definitionName: 'BridgeDeck' });

    expect(result).toMatchObject({
      ok: false,
      error: {
        stage: 'source-file',
        code: 'COMPONENT_SOURCE_READ_FAILED',
        context: {
          semanticKey: BRIDGE_DECK,
          definitionName: 'BridgeDeck',
          path: 'examples/infra-bridge/src/families/bridgeDeck.tsx',
        },
        retryable: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain('/private/repo');
  });
});

describe('TSX highlighting', () => {
  it('keeps native pre/code line structure, line numbers, blank lines, and both themes', async () => {
    const html = await highlightTsxSource('const a = 1;\n\nconst b = 2;');

    expect(html).toMatch(/^<pre[^>]*class="shiki shiki-themes/u);
    expect(html).toContain('<code>');
    expect(html.match(/class="line"/gu)).toHaveLength(3);
    expect(html).toContain('data-line="1"');
    expect(html).toContain('data-line="2"');
    expect(html).toContain('data-line="3"');
    expect(html).toContain('--shiki-dark:');
    expect(html).not.toContain('code-line');
  });
});
