import { stat, utimes } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import puppeteer, { type Page } from 'puppeteer';
import { startWorkbench } from '../server/startWorkbench.js';
import { verifyWorkbenchParity } from './parity.js';

const TEXT_BEARING_KEY = 'infra-bridge/rail-site-01/rail-bridge-01/superstructure/name-sign-01';
const WATCHED_SOURCE = fileURLToPath(
  new URL('../../../../examples/infra-bridge/src/families/bridgeNameSign.tsx', import.meta.url)
);
export const SMOKE_DEADLINE_MS = 120_000;
const READY_TIMEOUT_MS = 30_000;

interface BrowserEvidence {
  readonly canvas: readonly [number, number];
  readonly productCount: number;
  readonly refreshedRevision: number;
  readonly componentSource: Readonly<{
    lineCount: number;
    refreshedRevision: number;
  }>;
  readonly responsiveSelectors: Readonly<{
    tablet: number;
    mobile: number;
  }>;
}

interface BrowserErrorMonitor {
  readonly errors: string[];
  readonly firstError: Promise<Error>;
  readonly record: (message: string) => void;
}

interface WorkbenchReadinessOutcome {
  readonly kind: 'ready' | 'failure';
  readonly detail?: string | undefined;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { ifc: { type: 'string' } },
    strict: true,
  });
  if (values.ifc === undefined || values.ifc.length === 0) {
    throw new Error('Usage: npm run workbench:smoke -- --ifc <path-to-Infra-Bridge.ifc>');
  }
  const ifcPath = resolve(process.cwd(), values.ifc);

  let closeServer: (() => Promise<void>) | undefined;
  let closeBrowser: (() => Promise<void>) | undefined;
  let restoreSourceTimestamp: (() => Promise<void>) | undefined;
  let closeRequested = false;
  let stage = 'starting the local workbench';
  const closeResources = async (): Promise<void> => {
    closeRequested = true;
    const failures: unknown[] = [];
    for (const close of [closeBrowser, closeServer, restoreSourceTimestamp]) {
      if (close === undefined) continue;
      try {
        await close();
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Workbench smoke could not close every live resource');
    }
  };

  try {
    const result = await runWithSmokeDeadline(
      async (signal) => {
        const started = await startWorkbench({
          ifcPath,
          port: 0,
          log: (message) => {
            process.stdout.write(`${message}\n`);
          },
        });
        closeServer = onceAsync(started.close);
        if (closeRequested) await closeServer();
        throwIfAborted(signal);

        stage = 'comparing all 47 manifest products';
        const summary = await verifyWorkbenchParity({
          runtime: started.runtime,
          signal,
          onProgress({ index, total, semanticKey }) {
            throwIfAborted(signal);
            process.stdout.write(`[${String(index)}/${String(total)}] ${semanticKey}\n`);
          },
        });
        throwIfAborted(signal);

        stage = 'exercising the desktop, tablet, and mobile browser workbench';
        const browserEvidence = await verifyBrowser(
          started.url,
          signal,
          async (cleanup) => {
            closeBrowser = cleanup;
            if (closeRequested) await cleanup();
          },
          async (cleanup) => {
            restoreSourceTimestamp = cleanup;
            if (closeRequested) await cleanup();
          }
        );
        return { ...summary, browserEvidence };
      },
      closeResources,
      SMOKE_DEADLINE_MS,
      () => stage
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await closeResources();
  }
}

/** Runs the complete smoke inside one finite wall-clock budget and cleans up before timeout. */
export async function runWithSmokeDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  cleanup: () => Promise<void>,
  deadlineMs = SMOKE_DEADLINE_MS,
  currentStage: () => string = () => 'running the smoke'
): Promise<T> {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    throw new Error(
      `Smoke deadline must be a positive finite duration, received ${String(deadlineMs)}`
    );
  }
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const error = new Error(
        `Workbench smoke exceeded its ${String(deadlineMs)} ms wall-clock deadline while ${currentStage()}`
      );
      controller.abort(error);
      void cleanup().then(
        () => {
          reject(error);
        },
        (cleanupError: unknown) => {
          reject(
            new AggregateError(
              [error, cleanupError],
              `${error.message}; timed-out resources also failed to close`
            )
          );
        }
      );
    }, deadlineMs);
  });

  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function verifyBrowser(
  url: string,
  signal: AbortSignal,
  registerCleanup: (cleanup: () => Promise<void>) => Promise<void>,
  registerSourceRestore: (cleanup: () => Promise<void>) => Promise<void>
): Promise<BrowserEvidence> {
  smokeProgress('browser', 'launching Chromium');
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    ],
  });
  const closeBrowser = onceAsync(async () => browser.close());
  await registerCleanup(closeBrowser);
  try {
    throwIfAborted(signal);
    const page = await browser.newPage();
    const monitor = observeBrowserErrors(page);
    await page.setViewport({ width: 1_440, height: 900, deviceScaleFactor: 1 });
    const response = await raceBrowserFailure(
      monitor,
      page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      })
    );
    if (response?.ok() !== true) {
      throw new Error(`Workbench navigation returned HTTP ${String(response?.status())}`);
    }
    smokeProgress('browser', 'waiting for the complete-model overview');
    await waitForReady(page, monitor);
    await verifyOverallMode(page, monitor);
    smokeProgress('browser', 'complete-model overview ready');

    await clickControl(page, monitor, 'Manifest products', 'true');
    await raceBrowserFailure(monitor, page.waitForSelector('.product-option', { timeout: 10_000 }));
    await waitForReady(page, monitor);
    smokeProgress('browser', 'Manifest products mode ready');

    const productKeys = await page.$$eval('.product-option', (elements) =>
      elements.map((element) =>
        element instanceof HTMLElement ? (element.dataset['semanticKey'] ?? '') : ''
      )
    );
    const productCount = productKeys.length;
    if (productCount !== 47 || new Set(productKeys).size !== 47 || productKeys.includes('')) {
      throw new Error(
        `Expected 47 unique selectable Semantic Keys, rendered ${String(productCount)} rows / ${String(new Set(productKeys).size)} unique keys`
      );
    }
    await verifyRequiredEvidenceAndControls(page);
    await verifyLightThemeAndEvidenceScroll(page, monitor);

    await verifyEveryBrowserSelection(page, monitor, productKeys);

    await exerciseControls(page, monitor);
    const sectionPositionBefore = await sectionPosition(page);
    const canvasBefore = await page.$('canvas');
    if (canvasBefore === null) throw new Error('The shared R3F canvas was not mounted');
    const canvas = await canvasBefore.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return [Math.round(bounds.width), Math.round(bounds.height)] as const;
    });
    if (canvas[0] <= 0 || canvas[1] <= 0) {
      throw new Error(`The shared R3F canvas has invalid bounds ${canvas.join('×')}`);
    }

    const revisionBefore = await revision(page);
    await page.click('.primary-action');
    await raceBrowserFailure(monitor, page.waitForSelector('.previous-result', { timeout: 5_000 }));
    smokeProgress('browser', `waiting for recompute after revision ${String(revisionBefore)}`);
    await waitForReady(page, monitor, {
      semanticKey: TEXT_BEARING_KEY,
      minimumRevision: revisionBefore + 1,
    });
    smokeProgress('browser', 'recompute ready');
    const canvasStayedMounted = await page.evaluate(
      (before) => before === document.querySelector('canvas'),
      canvasBefore
    );
    await canvasBefore.dispose();
    if (!canvasStayedMounted) throw new Error('Recompute replaced the shared R3F canvas');

    await assertControlStates(page, {
      Candidate: 'true',
      Orthographic: 'true',
      'Section plane': 'true',
      'CAD Z': 'true',
      'Flip section': 'true',
      Grid: 'true',
      Iso: 'true',
    });
    const preserved = await page.evaluate(() => ({
      semanticKey: document.querySelector('.selected-key code')?.textContent.trim(),
      sectionPosition: document.querySelector<HTMLInputElement>(
        'input[aria-label="Section position"]'
      )?.value,
    }));
    if (
      preserved.semanticKey !== TEXT_BEARING_KEY ||
      preserved.sectionPosition !== sectionPositionBefore
    ) {
      throw new Error(`Recompute did not preserve browser state: ${JSON.stringify(preserved)}`);
    }

    const tabletCount = await verifyCompactLayout(page, monitor, productKeys, 900, false);
    const mobileCount = await verifyCompactLayout(page, monitor, productKeys, 600, true);
    const componentSource = await verifyComponentSourceMode(
      page,
      monitor,
      signal,
      registerSourceRestore
    );
    await delay(100);
    if (monitor.errors.length > 0) {
      throw new Error(`Browser smoke errors:\n${monitor.errors.join('\n')}`);
    }
    return {
      canvas,
      productCount,
      refreshedRevision: await revision(page),
      componentSource,
      responsiveSelectors: { tablet: tabletCount, mobile: mobileCount },
    };
  } finally {
    await closeBrowser();
  }
}

async function verifyEveryBrowserSelection(
  page: Page,
  monitor: BrowserErrorMonitor,
  semanticKeys: readonly string[]
): Promise<void> {
  smokeProgress('browser', 'selecting all 47 Semantic Key rows');
  const ordered = [
    ...semanticKeys.filter((semanticKey) => semanticKey !== TEXT_BEARING_KEY),
    TEXT_BEARING_KEY,
  ];
  for (const [index, semanticKey] of ordered.entries()) {
    await page.evaluate((selectedKey) => {
      const selected = [...document.querySelectorAll<HTMLElement>('.product-option')].find(
        (option) => option.dataset['semanticKey'] === selectedKey
      );
      if (selected === undefined) throw new Error(`Missing Semantic Key: ${selectedKey}`);
      selected.click();
    }, semanticKey);
    await waitForReady(page, monitor, { semanticKey });
    if ((index + 1) % 10 === 0 || index + 1 === ordered.length) {
      smokeProgress(
        'browser',
        `selected ${String(index + 1)}/${String(ordered.length)} Semantic Keys`
      );
    }
  }
  smokeProgress('browser', 'text-bearing comparison ready');
}

async function composedCanvasEvidence(
  page: Page,
  pngBase64: string,
  index: number
): Promise<{ readonly background: number; readonly accentSamples: number }> {
  return page.evaluate(
    async (encoded, canvasIndex) => {
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let byte = 0; byte < binary.length; byte += 1) {
        bytes[byte] = binary.charCodeAt(byte);
      }
      const image = await createImageBitmap(new Blob([bytes.buffer], { type: 'image/png' }));
      const surface = document.createElement('canvas');
      surface.width = image.width;
      surface.height = image.height;
      const context = surface.getContext('2d', { willReadFrequently: true });
      if (context === null) throw new Error('Screenshot pixel surface could not be created');
      context.drawImage(image, 0, 0);
      image.close();
      const pixels = context.getImageData(0, 0, surface.width, surface.height).data;
      const corners = [
        [2, 2],
        [Math.max(2, surface.width - 3), 2],
        [2, Math.max(2, surface.height - 3)],
      ] as const;
      let background = 0;
      for (const [x, y] of corners) {
        const offset = (y * surface.width + x) * 4;
        background +=
          ((pixels[offset] ?? 0) + (pixels[offset + 1] ?? 0) + (pixels[offset + 2] ?? 0)) / 3;
      }
      background /= corners.length;
      let accentSamples = 0;
      for (let row = 0; row < 24; row += 1) {
        for (let column = 0; column < 36; column += 1) {
          const x = Math.min(surface.width - 1, Math.floor(((column + 0.5) / 36) * surface.width));
          const y = Math.min(surface.height - 1, Math.floor(((row + 0.5) / 24) * surface.height));
          const offset = (y * surface.width + x) * 4;
          const red = pixels[offset] ?? 0;
          const green = pixels[offset + 1] ?? 0;
          const blue = pixels[offset + 2] ?? 0;
          const referenceColor = blue > red + 28 && green > red + 20;
          const candidateColor = red > green + 28 && red > blue + 50;
          if (canvasIndex === 0 ? referenceColor : candidateColor) accentSamples += 1;
        }
      }
      return { background, accentSamples };
    },
    pngBase64,
    index
  );
}

async function verifyOverallMode(page: Page, monitor: BrowserErrorMonitor): Promise<void> {
  await page.evaluate(() => {
    const lightMode = document.querySelector<HTMLButtonElement>('button[aria-label="Light mode"]');
    if (lightMode === null) throw new Error('Light mode control is missing');
    if (lightMode.getAttribute('aria-pressed') !== 'true') lightMode.click();
  });
  await raceBrowserFailure(
    monitor,
    page.waitForFunction(() => document.documentElement.dataset['theme'] === 'light', {
      timeout: 5_000,
    })
  );
  await delay(500);

  const canvasesBefore = await page.$$('canvas');
  if (canvasesBefore.length !== 2) {
    throw new Error(`Overall mode mounted ${String(canvasesBefore.length)} canvases instead of 2`);
  }
  const [referenceBefore, candidateBefore] = canvasesBefore;
  if (referenceBefore === undefined || candidateBefore === undefined) {
    throw new Error('Overall mode canvas handles were unavailable');
  }
  const screenshots = await Promise.all(
    canvasesBefore.map((canvas) => canvas.screenshot({ type: 'png', encoding: 'base64' }))
  );
  const canvasVisuals = await Promise.all(
    screenshots.map((screenshot, index) => composedCanvasEvidence(page, screenshot, index))
  );

  const state = await page.evaluate(() => {
    return {
      railButtons: document.querySelectorAll('.mode-rail__button').length,
      overallPressed: document
        .querySelector<HTMLButtonElement>('button[aria-label="Overall comparison"]')
        ?.getAttribute('aria-pressed'),
      productsPressed: document
        .querySelector<HTMLButtonElement>('button[aria-label="Manifest products"]')
        ?.getAttribute('aria-pressed'),
      sourcePressed: document
        .querySelector<HTMLButtonElement>('button[aria-label="Component source"]')
        ?.getAttribute('aria-pressed'),
      referenceLabel: document.querySelector('.overall-model-label--reference')?.textContent.trim(),
      candidateLabel: document.querySelector('.overall-model-label--candidate')?.textContent.trim(),
      productCount: document.querySelector('.overall-toolbar__title small')?.textContent.trim(),
      productRail: document.querySelector('.product-pane') !== null,
      theme: document.documentElement.dataset['theme'],
      canvases: [...document.querySelectorAll<HTMLCanvasElement>('canvas')].map((canvas) => {
        const bounds = canvas.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      }),
    };
  });
  const visualState = {
    ...state,
    canvases: state.canvases.map((canvas, index) => ({
      ...canvas,
      background: canvasVisuals[index]?.background ?? -1,
      accentSamples: canvasVisuals[index]?.accentSamples ?? 0,
    })),
  };
  const [referenceCanvas, candidateCanvas] = visualState.canvases;
  if (
    visualState.railButtons !== 3 ||
    visualState.overallPressed !== 'true' ||
    visualState.productsPressed !== 'false' ||
    visualState.sourcePressed !== 'false' ||
    visualState.referenceLabel?.includes('Reference model') !== true ||
    visualState.candidateLabel?.includes('Candidate model') !== true ||
    visualState.productCount?.includes('47 products per side') !== true ||
    visualState.productRail ||
    visualState.theme !== 'light' ||
    visualState.canvases.length !== 2 ||
    referenceCanvas === undefined ||
    candidateCanvas === undefined ||
    referenceCanvas.width < 320 ||
    referenceCanvas.height < 320 ||
    Math.abs(referenceCanvas.width - candidateCanvas.width) > 2 ||
    Math.abs(referenceCanvas.height - candidateCanvas.height) > 2 ||
    referenceCanvas.background < 170 ||
    candidateCanvas.background < 170 ||
    referenceCanvas.accentSamples < 3 ||
    candidateCanvas.accentSamples < 3
  ) {
    throw new Error(`Overall mode is incomplete: ${JSON.stringify(visualState)}`);
  }

  const revisionBefore = await revision(page);
  await page.click('.primary-action');
  await waitForReady(page, monitor, { minimumRevision: revisionBefore + 1 });
  const canvasesStayedMounted = await page.evaluate(
    (beforeReference, beforeCandidate) => {
      const [referenceAfter, candidateAfter] = document.querySelectorAll('canvas');
      return beforeReference === referenceAfter && beforeCandidate === candidateAfter;
    },
    referenceBefore,
    candidateBefore
  );
  await Promise.all(canvasesBefore.map(async (canvas) => canvas.dispose()));
  if (!canvasesStayedMounted) throw new Error('Overall recompute replaced a model canvas');
}

async function verifyRequiredEvidenceAndControls(page: Page): Promise<void> {
  const requiredControls = [
    'Overall comparison',
    'Manifest products',
    'Component source',
    'Reference',
    'Candidate',
    'Overlay',
    'Reference visible',
    'Reference x-ray',
    'Reference edges',
    'Candidate visible',
    'Candidate x-ray',
    'Candidate edges',
    'Section plane',
    'Iso',
    'Front',
    'Top',
    'Right',
    'Orthographic',
    'Fit',
    'Grid',
    'Recompute',
  ];
  const renderedControls = new Set(
    await page.$$eval('button', (elements) =>
      elements.map((element) => element.getAttribute('aria-label') ?? element.textContent.trim())
    )
  );
  const missing = requiredControls.filter((label) => !renderedControls.has(label));
  if (missing.length > 0) throw new Error(`Missing browser controls: ${missing.join(', ')}`);

  const evidence = await page.$eval('.evidence-column', (element) => element.textContent);
  for (const label of [
    'Control point',
    'Envelope maximum',
    'Surface maximum',
    'Surface mean',
    'Surface P95',
    'Normal mean',
    'Normal minimum',
    'Volume error',
    'Closed-solid IoU',
  ]) {
    if (!evidence.includes(label)) throw new Error(`Missing browser evidence: ${label}`);
  }
}

async function verifyLightThemeAndEvidenceScroll(
  page: Page,
  monitor: BrowserErrorMonitor
): Promise<void> {
  await page.evaluate(() => {
    const lightMode = document.querySelector<HTMLButtonElement>('button[aria-label="Light mode"]');
    if (lightMode === null) throw new Error('Light mode control is missing');
    if (lightMode.getAttribute('aria-pressed') !== 'true') lightMode.click();
  });
  await raceBrowserFailure(
    monitor,
    page.waitForFunction(() => document.documentElement.dataset['theme'] === 'light', {
      timeout: 5_000,
    })
  );

  const colors = await page.evaluate(() => {
    const selectedMode = document.querySelector<HTMLButtonElement>(
      '.mode-switcher .control-button[aria-pressed="true"]'
    );
    const coordinateBadge = document.querySelector<HTMLElement>('.coordinate-badge');
    if (selectedMode === null || coordinateBadge === null) {
      throw new Error('Light mode visual controls are missing');
    }
    const selected = getComputedStyle(selectedMode);
    const badge = getComputedStyle(coordinateBadge);
    return {
      selectedBackground: selected.backgroundColor,
      selectedColor: selected.color,
      badgeBackground: badge.backgroundColor,
      badgeColor: badge.color,
    };
  });
  if (
    colors.selectedBackground !== 'rgb(8, 127, 121)' ||
    colors.selectedColor !== 'rgb(255, 255, 255)' ||
    colors.badgeBackground !== 'rgba(255, 255, 255, 0.86)' ||
    colors.badgeColor !== 'rgb(52, 69, 76)'
  ) {
    throw new Error(`Light mode controls are not legible: ${JSON.stringify(colors)}`);
  }

  const dimensions = await page.$eval('.evidence-scroll', (element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  if (dimensions.scrollHeight <= dimensions.clientHeight) {
    throw new Error(`Evidence ledger is not constrained: ${JSON.stringify(dimensions)}`);
  }
  await page.hover('.evidence-scroll');
  await page.mouse.wheel({ deltaY: 600 });
  await raceBrowserFailure(
    monitor,
    page.waitForFunction(
      () => (document.querySelector<HTMLElement>('.evidence-scroll')?.scrollTop ?? 0) > 0,
      { timeout: 5_000 }
    )
  );
  await page.$eval('.evidence-scroll', (element) => {
    element.scrollTop = 0;
  });
}

async function exerciseControls(page: Page, monitor: BrowserErrorMonitor): Promise<void> {
  await clickControl(page, monitor, 'Reference', 'true');
  await assertControlStates(page, {
    'Reference visible': 'true',
    'Reference x-ray': 'false',
    'Reference edges': 'true',
    'Candidate visible': 'false',
  });

  await clickControl(page, monitor, 'Reference visible', 'false');
  await clickControl(page, monitor, 'Reference x-ray', 'true');
  await clickControl(page, monitor, 'Reference edges', 'false');
  await clickControl(page, monitor, 'Candidate visible', 'true');
  await clickControl(page, monitor, 'Candidate x-ray', 'true');
  await clickControl(page, monitor, 'Candidate edges', 'false');
  await assertControlStates(page, {
    'Reference visible': 'false',
    'Reference x-ray': 'true',
    'Reference edges': 'false',
    'Candidate visible': 'true',
    'Candidate x-ray': 'true',
    'Candidate edges': 'false',
  });

  await clickControl(page, monitor, 'Overlay', 'true');
  await assertControlStates(page, {
    'Reference visible': 'true',
    'Reference x-ray': 'true',
    'Reference edges': 'false',
    'Candidate visible': 'true',
    'Candidate x-ray': 'false',
    'Candidate edges': 'true',
  });

  await clickControl(page, monitor, 'Grid', 'false');
  await clickControl(page, monitor, 'Grid', 'true');
  for (const camera of ['Front', 'Top', 'Right', 'Iso']) {
    await clickControl(page, monitor, camera, 'true');
  }
  await clickControl(page, monitor, 'Fit');
  await clickControl(page, monitor, 'Section plane', 'true');
  await clickControl(page, monitor, 'CAD Y', 'true');
  await clickControl(page, monitor, 'CAD Z', 'true');
  await setSectionPosition(page, monitor);
  await clickControl(page, monitor, 'Flip section', 'true');
  await clickControl(page, monitor, 'Orthographic', 'true');
  await clickControl(page, monitor, 'Candidate', 'true');
}

async function clickControl(
  page: Page,
  monitor: BrowserErrorMonitor,
  label: string,
  expectedPressed?: 'true' | 'false'
): Promise<void> {
  await raceBrowserFailure(
    monitor,
    page.evaluate((controlLabel) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (candidate) => candidate.getAttribute('aria-label') === controlLabel
      );
      if (button === undefined) throw new Error(`Missing control: ${controlLabel}`);
      button.click();
    }, label)
  );
  if (expectedPressed === undefined) return;
  await raceBrowserFailure(
    monitor,
    page.waitForFunction(
      (controlLabel, pressed) =>
        [...document.querySelectorAll<HTMLButtonElement>('button')].some(
          (button) =>
            button.getAttribute('aria-label') === controlLabel &&
            button.getAttribute('aria-pressed') === pressed
        ),
      { timeout: 5_000 },
      label,
      expectedPressed
    )
  );
}

async function assertControlStates(
  page: Page,
  expected: Readonly<Record<string, 'true' | 'false'>>
): Promise<void> {
  const labels = Object.keys(expected);
  const actualEntries = await page.evaluate((controlLabels) => {
    return controlLabels.map((label) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (candidate) => candidate.getAttribute('aria-label') === label
      );
      return [label, button?.getAttribute('aria-pressed') ?? null] as const;
    });
  }, labels);
  const actual = Object.fromEntries(actualEntries);
  const mismatches = labels.filter((label) => actual[label] !== expected[label]);
  if (mismatches.length > 0) {
    throw new Error(
      `Control state mismatch: ${mismatches
        .map(
          (label) =>
            `${label} expected ${String(expected[label])} / received ${String(actual[label])}`
        )
        .join(', ')}`
    );
  }
}

async function setSectionPosition(page: Page, monitor: BrowserErrorMonitor): Promise<void> {
  const before = await page.$eval('input[aria-label="Section position"]', (input) => ({
    minimum: Number.parseFloat(input.getAttribute('min') ?? '0'),
    maximum: Number.parseFloat(input.getAttribute('max') ?? '0'),
    value: Number.parseFloat(input.value),
  }));
  if (
    !Number.isFinite(before.minimum) ||
    !Number.isFinite(before.maximum) ||
    before.minimum >= before.maximum
  ) {
    throw new Error(`Section slider has no usable range: ${JSON.stringify(before)}`);
  }
  await page.focus('input[aria-label="Section position"]');
  await page.keyboard.press(
    Math.abs(before.value - before.minimum) < Math.abs(before.value - before.maximum)
      ? 'End'
      : 'Home'
  );
  await raceBrowserFailure(
    monitor,
    page.waitForFunction(
      (previous) => {
        const input = document.querySelector<HTMLInputElement>(
          'input[aria-label="Section position"]'
        );
        return input !== null && Number.parseFloat(input.value) !== previous;
      },
      { timeout: 5_000 },
      before.value
    )
  );
}

async function verifyCompactLayout(
  page: Page,
  monitor: BrowserErrorMonitor,
  expectedKeys: readonly string[],
  width: number,
  mobile: boolean
): Promise<number> {
  await page.setViewport({ width, height: 800, deviceScaleFactor: 1 });
  await page.evaluate(
    () =>
      new Promise<void>((resolveFrame) => {
        requestAnimationFrame(() => {
          resolveFrame();
        });
      })
  );
  const selector = await page.$eval('select[aria-label="Select Semantic Key"]', (element) => {
    const select = element;
    const bounds = select.getBoundingClientRect();
    return {
      values: [...select.options]
        .filter((option) => !option.disabled)
        .map((option) => option.value),
      labels: [...select.options].filter((option) => !option.disabled).map((option) => option.text),
      value: select.value,
      visible: bounds.width > 0 && bounds.height > 0,
    };
  });
  const expected = [...expectedKeys].sort();
  const received = [...selector.values].sort();
  if (
    !selector.visible ||
    selector.value !== TEXT_BEARING_KEY ||
    JSON.stringify(received) !== JSON.stringify(expected) ||
    new Set(selector.labels).size !== expectedKeys.length
  ) {
    throw new Error(
      `The ${String(width)}px Semantic Key selector is ambiguous or incomplete: ${JSON.stringify({
        visible: selector.visible,
        selected: selector.value,
        options: selector.values.length,
        uniqueLabels: new Set(selector.labels).size,
      })}`
    );
  }

  if (!mobile) {
    const alternateKey = expectedKeys.find((semanticKey) => semanticKey !== TEXT_BEARING_KEY);
    if (alternateKey === undefined) throw new Error('Compact selector has no alternate product');
    await page.select('select[aria-label="Select Semantic Key"]', alternateKey);
    await waitForReady(page, monitor, { semanticKey: alternateKey });
    await page.select('select[aria-label="Select Semantic Key"]', TEXT_BEARING_KEY);
    await waitForReady(page, monitor, { semanticKey: TEXT_BEARING_KEY });
  } else {
    await page.type('input[aria-label="Search Semantic Keys"]', 'name-sign-01');
    await raceBrowserFailure(
      monitor,
      page.waitForFunction(
        (total) => {
          const options = [
            ...document.querySelectorAll<HTMLOptionElement>(
              'select[aria-label="Select Semantic Key"] option:not(:disabled)'
            ),
          ];
          return options.length > 0 && options.length < total;
        },
        { timeout: 5_000 },
        expectedKeys.length
      )
    );
    await page.click('button[aria-label="Clear Semantic Key search"]');
    await raceBrowserFailure(
      monitor,
      page.waitForFunction(
        (total) =>
          document.querySelectorAll(
            'select[aria-label="Select Semantic Key"] option:not(:disabled)'
          ).length === total,
        { timeout: 5_000 },
        expectedKeys.length
      )
    );
  }

  const sectionLayout = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('.viewport-pane');
    const stage = document.querySelector<HTMLElement>('.viewport-stage');
    const controls = document.querySelector<HTMLDetailsElement>('.viewport-controls');
    const evidence = document.querySelector<HTMLDetailsElement>('.evidence-pane');
    const labels = ['Section plane', 'CAD X', 'CAD Y', 'CAD Z', 'Flip section'];
    const elements = [
      ...labels.map((label) =>
        [...document.querySelectorAll<HTMLButtonElement>('button')].find(
          (button) => button.getAttribute('aria-label') === label
        )
      ),
      document.querySelector<HTMLInputElement>('input[aria-label="Section position"]'),
    ];
    if (
      pane === null ||
      stage === null ||
      controls === null ||
      evidence === null ||
      elements.some((element) => element === undefined || element === null)
    ) {
      return { missing: true };
    }
    const paneBounds = pane.getBoundingClientRect();
    const stageBounds = stage.getBoundingClientRect();
    const controlsBounds = controls.getBoundingClientRect();
    const evidenceBounds = evidence.getBoundingClientRect();
    const clipped = elements.flatMap((element) => {
      if (element === undefined || element === null) return ['missing'];
      const bounds = element.getBoundingClientRect();
      return bounds.width <= 0 ||
        bounds.height <= 0 ||
        bounds.left < paneBounds.left - 1 ||
        bounds.right > paneBounds.right + 1
        ? [element.getAttribute('aria-label') ?? 'section position']
        : [];
    });
    return {
      missing: false,
      clipped,
      stageTop: stageBounds.top,
      stageBottom: stageBounds.bottom,
      controlsTop: controlsBounds.top,
      evidenceTop: evidenceBounds.top,
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
  if (
    sectionLayout.missing ||
    (sectionLayout.clipped?.length ?? 0) > 0 ||
    sectionLayout.pageOverflow === true
  ) {
    throw new Error(
      `The ${String(width)}px section controls are missing or clipped: ${JSON.stringify(sectionLayout)}`
    );
  }
  if (
    mobile &&
    !(
      (sectionLayout.stageTop ?? Number.POSITIVE_INFINITY) <
        (sectionLayout.controlsTop ?? Number.NEGATIVE_INFINITY) &&
      (sectionLayout.stageBottom ?? Number.POSITIVE_INFINITY) <=
        (sectionLayout.controlsTop ?? Number.NEGATIVE_INFINITY) + 1 &&
      (sectionLayout.stageTop ?? Number.POSITIVE_INFINITY) <
        (sectionLayout.evidenceTop ?? Number.NEGATIVE_INFINITY)
    )
  ) {
    throw new Error(
      `The mobile canvas is not above Controls and Evidence: ${JSON.stringify(sectionLayout)}`
    );
  }
  if (mobile) await verifyNativeCollapsibles(page, monitor);
  return selector.values.length;
}

async function verifyComponentSourceMode(
  page: Page,
  monitor: BrowserErrorMonitor,
  signal: AbortSignal,
  registerSourceRestore: (cleanup: () => Promise<void>) => Promise<void>
): Promise<{ readonly lineCount: number; readonly refreshedRevision: number }> {
  await page.setViewport({ width: 1_440, height: 900, deviceScaleFactor: 1 });
  await clickControl(page, monitor, 'Component source', 'true');
  await waitForReady(page, monitor, { semanticKey: TEXT_BEARING_KEY });
  await raceBrowserFailure(
    monitor,
    page.waitForSelector('.component-source-code .shiki > code > .line', { timeout: 10_000 })
  );

  const sourceState = await page.evaluate(() => {
    const source = document.querySelector<HTMLElement>('.component-source-code');
    const path = document.querySelector<HTMLElement>('.source-file-actions > code');
    const canvas = document.querySelector<HTMLCanvasElement>('canvas');
    const canvasBounds = canvas?.getBoundingClientRect();
    return {
      railButtons: document.querySelectorAll('.mode-rail__button').length,
      sourcePressed: document
        .querySelector<HTMLButtonElement>('button[aria-label="Component source"]')
        ?.getAttribute('aria-pressed'),
      definition: document.querySelector('.component-source-context small')?.textContent.trim(),
      fileName: document.querySelector('.component-source-pane__header strong')?.textContent.trim(),
      path: path?.textContent.trim(),
      lineCount: document.querySelectorAll('.component-source-code .line').length,
      hasNativeStructure:
        document.querySelector('.component-source-code > pre.shiki > code') !== null,
      sourceScrollable:
        source !== null && source.scrollHeight > source.clientHeight && source.clientHeight > 0,
      canvasCount: document.querySelectorAll('canvas').length,
      canvasWidth: canvasBounds?.width ?? 0,
      canvasHeight: canvasBounds?.height ?? 0,
      evidenceVisible: document.querySelector('.evidence-column') !== null,
      theme: document.documentElement.dataset['theme'],
      productCount: document.querySelectorAll('.product-option').length,
    };
  });
  const sourceCanvas = await page.$('canvas');
  if (sourceCanvas === null) throw new Error('Component Source Candidate canvas was not mounted');
  const sourceScreenshot = await sourceCanvas.screenshot({ type: 'png', encoding: 'base64' });
  await sourceCanvas.dispose();
  const sourceVisual = await composedCanvasEvidence(page, sourceScreenshot, 1);
  const visualSourceState = { ...sourceState, ...sourceVisual };
  if (
    visualSourceState.railButtons !== 3 ||
    visualSourceState.sourcePressed !== 'true' ||
    visualSourceState.definition?.includes('BridgeNameSign') !== true ||
    visualSourceState.fileName !== 'bridgeNameSign.tsx' ||
    visualSourceState.path !== 'examples/infra-bridge/src/families/bridgeNameSign.tsx' ||
    visualSourceState.lineCount < 40 ||
    !visualSourceState.hasNativeStructure ||
    !visualSourceState.sourceScrollable ||
    visualSourceState.canvasCount !== 1 ||
    visualSourceState.canvasWidth < 360 ||
    visualSourceState.canvasHeight < 320 ||
    visualSourceState.background < 170 ||
    visualSourceState.accentSamples < 3 ||
    visualSourceState.evidenceVisible ||
    visualSourceState.theme !== 'light' ||
    visualSourceState.productCount !== 47
  ) {
    throw new Error(`Component Source mode is incomplete: ${JSON.stringify(visualSourceState)}`);
  }

  await page.$eval('.component-source-code', (element) => {
    element.scrollTop = Math.min(240, element.scrollHeight - element.clientHeight);
  });
  await clickControl(page, monitor, 'Top', 'true');
  await clickControl(page, monitor, 'Candidate x-ray', 'true');
  await clickControl(page, monitor, 'Orthographic', 'true');
  await clickControl(page, monitor, 'Section plane', 'true');
  const explicitRevision = await revision(page);
  const explicitCanvas = await page.$('canvas');
  if (explicitCanvas === null) throw new Error('Component Source canvas was not mounted');
  await page.click('.primary-action');
  await raceBrowserFailure(
    monitor,
    page.waitForSelector('.component-source-previous', { timeout: 5_000 })
  );
  await waitForReady(page, monitor, {
    semanticKey: TEXT_BEARING_KEY,
    minimumRevision: explicitRevision + 1,
  });
  const explicitPreserved = await page.evaluate(
    (before) => ({
      canvas: before === document.querySelector('canvas'),
      scrollTop: document.querySelector<HTMLElement>('.component-source-code')?.scrollTop ?? 0,
      selected: document.querySelector('.selected-key code')?.textContent.trim(),
    }),
    explicitCanvas
  );
  await explicitCanvas.dispose();
  if (
    !explicitPreserved.canvas ||
    explicitPreserved.scrollTop <= 0 ||
    explicitPreserved.selected !== TEXT_BEARING_KEY
  ) {
    throw new Error(`Component Source recompute lost state: ${JSON.stringify(explicitPreserved)}`);
  }
  await assertControlStates(page, {
    Top: 'true',
    'Candidate x-ray': 'true',
    Orthographic: 'true',
    'Section plane': 'true',
  });

  const original = await stat(WATCHED_SOURCE);
  let touched = false;
  const restore = onceAsync(async () => {
    if (!touched) return;
    await utimes(WATCHED_SOURCE, original.atime, original.mtime);
  });
  await registerSourceRestore(restore);
  throwIfAborted(signal);

  const revisionBefore = await revision(page);
  const canvasBefore = await page.$('canvas');
  if (canvasBefore === null) throw new Error('Source watcher could not find the mounted canvas');
  touched = true;
  await utimes(
    WATCHED_SOURCE,
    original.atime,
    new Date(Math.max(Date.now(), original.mtimeMs + 2_000))
  );
  smokeProgress('watcher', `touched ${WATCHED_SOURCE}`);
  await waitForReady(page, monitor, {
    semanticKey: TEXT_BEARING_KEY,
    minimumRevision: revisionBefore + 1,
  });
  const canvasStayedMounted = await page.evaluate(
    (before) => before === document.querySelector('canvas'),
    canvasBefore
  );
  await canvasBefore.dispose();
  if (!canvasStayedMounted) throw new Error('Source watcher replaced the Candidate R3F canvas');
  await assertControlStates(page, {
    Top: 'true',
    'Candidate x-ray': 'true',
    Orthographic: 'true',
    'Section plane': 'true',
    Grid: 'true',
  });
  const selected = await page.$eval(
    'select[aria-label="Select Semantic Key"]',
    (element) => element.value
  );
  if (selected !== TEXT_BEARING_KEY) {
    throw new Error(`Source watcher changed the selected Semantic Key to ${selected}`);
  }
  const refreshedRevision = await revision(page);
  smokeProgress(
    'watcher',
    `Component Source accepted revision ${String(refreshedRevision)} without replacing the canvas`
  );
  return { lineCount: visualSourceState.lineCount, refreshedRevision };
}

async function verifyNativeCollapsibles(page: Page, monitor: BrowserErrorMonitor): Promise<void> {
  for (const selector of ['.viewport-controls', '.evidence-pane']) {
    await page.click(`${selector} > summary`);
    await raceBrowserFailure(
      monitor,
      page.waitForFunction(
        (detailsSelector) => {
          const details = document.querySelector<HTMLDetailsElement>(detailsSelector);
          const body = details?.querySelector<HTMLElement>(':scope > :not(summary)');
          return (
            details?.open === false &&
            body !== null &&
            body !== undefined &&
            getComputedStyle(body).display === 'none'
          );
        },
        { timeout: 5_000 },
        selector
      )
    );
    await page.focus(`${selector} > summary`);
    await page.keyboard.press('Tab');
    const focusedClosedDescendant = await page.$eval(
      selector,
      (details) =>
        details.contains(document.activeElement) &&
        document.activeElement !== details.querySelector('summary')
    );
    if (focusedClosedDescendant) {
      throw new Error(`${selector} left an interactive descendant focusable while collapsed`);
    }
    await page.click(`${selector} > summary`);
    await raceBrowserFailure(
      monitor,
      page.waitForFunction(
        (detailsSelector) =>
          document.querySelector<HTMLDetailsElement>(detailsSelector)?.open === true,
        { timeout: 5_000 },
        selector
      )
    );
  }
}

function smokeProgress(stage: string, message: string): void {
  process.stdout.write(`[${stage}] ${message}\n`);
}

async function waitForReady(
  page: Page,
  monitor: BrowserErrorMonitor,
  expected: Readonly<{
    semanticKey?: string | undefined;
    minimumRevision?: number | undefined;
  }> = {}
): Promise<void> {
  const readiness = async (): Promise<void> => {
    const handle = await page.waitForFunction(
      (expectedKey, minimumRevision) => {
        const alert = [...document.querySelectorAll<HTMLElement>('[role="alert"]')].find(
          (element) => element.getClientRects().length > 0 || element.classList.contains('sr-only')
        );
        if (alert !== undefined) {
          const code = alert.querySelector('code')?.textContent.trim();
          const message = alert.querySelector('strong')?.textContent.trim();
          const action = alert.querySelector('p')?.textContent.trim();
          return {
            kind: 'failure',
            detail: [code, message, action, alert.textContent.trim()]
              .filter(
                (value, index, values) =>
                  value !== undefined && value.length > 0 && values.indexOf(value) === index
              )
              .join(' — '),
          };
        }
        const footer = document.querySelector<HTMLElement>('.footer-state');
        const ready =
          footer?.classList.contains('footer-state--ready') === true ||
          footer?.classList.contains('footer-state--fail') === true;
        const selected =
          document.querySelector('.selected-key code')?.textContent.trim() ??
          document.querySelector<HTMLSelectElement>('select[aria-label="Select Semantic Key"]')
            ?.value;
        const recompute = document.querySelector<HTMLButtonElement>('.primary-action');
        const revisionText = document.querySelector('.footer-ledger span')?.textContent ?? '';
        const revisionValue = Number.parseInt(revisionText.replace(/\D+/gu, ''), 10);
        const revisionReady =
          minimumRevision === undefined ||
          (Number.isFinite(revisionValue) && revisionValue >= minimumRevision);
        return ready &&
          recompute?.disabled === false &&
          revisionReady &&
          (expectedKey === undefined || selected === expectedKey)
          ? { kind: 'ready' }
          : false;
      },
      { timeout: READY_TIMEOUT_MS, polling: 100 },
      expected.semanticKey,
      expected.minimumRevision
    );
    const outcome: unknown = await handle.jsonValue();
    await handle.dispose();
    if (!isReadinessOutcome(outcome)) {
      throw new Error(`Workbench readiness returned an invalid state: ${JSON.stringify(outcome)}`);
    }
    if (outcome.kind === 'failure') {
      throw new Error(`Workbench reported a structured failure: ${outcome.detail ?? 'No detail'}`);
    }
  };

  try {
    await raceBrowserFailure(monitor, readiness());
  } catch (error: unknown) {
    const browserDetail =
      monitor.errors.length === 0
        ? ''
        : `\nCaptured browser failures:\n${monitor.errors.join('\n')}`;
    throw new Error(
      `Workbench did not become ready${
        expected.semanticKey === undefined ? '' : ` for ${expected.semanticKey}`
      }: ${error instanceof Error ? error.message : String(error)}${browserDetail}`,
      { cause: error }
    );
  }
}

function isReadinessOutcome(value: unknown): value is WorkbenchReadinessOutcome {
  if (typeof value !== 'object' || value === null) return false;
  const kind = 'kind' in value ? value.kind : undefined;
  const detail = 'detail' in value ? value.detail : undefined;
  return (
    (kind === 'ready' || kind === 'failure') && (detail === undefined || typeof detail === 'string')
  );
}

async function revision(page: Page): Promise<number> {
  return page.$eval('.footer-ledger span', (element) => {
    const value = Number.parseInt(element.textContent.replace(/\D+/gu, ''), 10);
    if (!Number.isFinite(value)) throw new Error('Workbench revision is not visible');
    return value;
  });
}

async function sectionPosition(page: Page): Promise<string> {
  return page.$eval('input[aria-label="Section position"]', (element) => element.value);
}

function observeBrowserErrors(page: Page): BrowserErrorMonitor {
  const errors: string[] = [];
  let resolveFirst: ((error: Error) => void) | undefined;
  const firstError = new Promise<Error>((resolveError) => {
    resolveFirst = resolveError;
  });
  const record = (message: string): void => {
    errors.push(message);
    resolveFirst?.(new Error(message));
    resolveFirst = undefined;
  };

  page.on('pageerror', (error: unknown) => {
    record(`[pageerror] ${error instanceof Error ? error.message : 'Unknown page error'}`);
  });
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText ?? 'unknown';
    if (errorText === 'net::ERR_ABORTED' && request.url().endsWith('/api/workbench')) return;
    record(`[netfail] ${request.url()} — ${errorText}`);
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    void response
      .text()
      .catch(() => '')
      .then((body) => {
        const detail = body.trim().slice(0, 1_000);
        record(
          `[net ${String(response.status())}] ${response.url()}${
            detail.length === 0 ? '' : ` — ${detail}`
          }`
        );
      });
  });
  page.on('console', (message) => {
    if (message.type() === 'error') record(`[console.error] ${message.text()}`);
  });
  return { errors, firstError, record };
}

async function raceBrowserFailure<T>(
  monitor: BrowserErrorMonitor,
  operation: Promise<T>
): Promise<T> {
  return Promise.race([
    operation,
    monitor.firstError.then((error) => {
      throw error;
    }),
  ]);
}

function onceAsync(operation: () => Promise<void>): () => Promise<void> {
  let result: Promise<void> | undefined;
  return () => {
    result ??= operation();
    return result;
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error('Workbench smoke was aborted');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds);
  });
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
