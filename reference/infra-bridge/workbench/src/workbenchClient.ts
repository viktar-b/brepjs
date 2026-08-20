import {
  WORKBENCH_API,
  type ComparisonDiagnostic,
  type DiagnosticContextValue,
  type WorkbenchCatalog,
  type WorkbenchDiagnosticError,
  type WorkbenchErrorStage,
  type WorkbenchResult,
} from '../shared/protocol.js';

export interface WorkbenchClientOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly baseUrl?: string;
}

export interface WorkbenchClientRequestState {
  readonly latestRequestId: number;
  readonly acceptedRevision: number;
}

export interface WorkbenchClient {
  loadCatalog(): Promise<WorkbenchResult<WorkbenchCatalog> | undefined>;
  loadComparison(semanticKey: string): Promise<WorkbenchResult<ComparisonDiagnostic> | undefined>;
  refreshComparison(
    semanticKey: string
  ): Promise<WorkbenchResult<ComparisonDiagnostic> | undefined>;
  cancelActive(): void;
  getRequestState(): WorkbenchClientRequestState;
}

type HttpMethod = 'GET' | 'POST';

export function createWorkbenchClient(options: WorkbenchClientOptions = {}): WorkbenchClient {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = options.baseUrl ?? '';
  let latestRequestId = 0;
  let acceptedRevision = 0;
  let activeController: AbortController | undefined;

  async function request<T>(
    route: string,
    method: HttpMethod,
    readValue: (value: unknown, revision: number) => T | undefined,
    expectedSemanticKey?: string
  ): Promise<WorkbenchResult<T> | undefined> {
    const requestId = latestRequestId + 1;
    latestRequestId = requestId;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;

    try {
      const response = await fetchImpl(resolveUrl(baseUrl, route), {
        method,
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      const text = await response.text();
      if (!isCurrentRequest(requestId, latestRequestId, controller)) return undefined;

      const parsed = parseJson(text);
      if (!parsed.ok) {
        return acceptCurrent(
          transportFailure(
            acceptedRevision,
            `http-${response.status.toString()}-non-json`,
            `The workbench server returned ${response.status.toString()} ${response.statusText || 'HTTP response'} instead of JSON.`,
            {
              status: response.status,
              response: text.slice(0, 240),
            },
            'Check the workbench server terminal, then retry the request.'
          ),
          requestId,
          controller
        );
      }

      const envelopeRevision = readEnvelopeRevision(parsed.value);
      if (envelopeRevision !== undefined && envelopeRevision < acceptedRevision) {
        return completeCurrent(
          staleRevisionFailure(envelopeRevision, acceptedRevision),
          requestId,
          controller
        );
      }
      const result = readWorkbenchResult(parsed.value, readValue);
      if (result === undefined) {
        return acceptCurrent(
          transportFailure(
            envelopeRevision ?? acceptedRevision,
            'invalid-json-response',
            'The workbench server returned JSON that does not match the diagnostic protocol.',
            { status: response.status },
            'Restart the workbench server so the browser and server use the same protocol.'
          ),
          requestId,
          controller
        );
      }

      const keyMismatch = expectedSemanticKeyMismatch(result, expectedSemanticKey);
      if (keyMismatch !== undefined) {
        return acceptCurrent(keyMismatch, requestId, controller);
      }
      return acceptCurrent(result, requestId, controller);
    } catch (error: unknown) {
      if (!isCurrentRequest(requestId, latestRequestId, controller) || isAbortError(error)) {
        return undefined;
      }
      return acceptCurrent(
        transportFailure(
          acceptedRevision,
          'network-error',
          error instanceof Error ? error.message : 'The workbench request failed.',
          { route },
          'Confirm the local workbench server is running, then retry the request.'
        ),
        requestId,
        controller
      );
    } finally {
      if (activeController === controller) activeController = undefined;
    }
  }

  function acceptCurrent<T>(
    result: WorkbenchResult<T>,
    requestId: number,
    controller: AbortController
  ): WorkbenchResult<T> | undefined {
    const current = completeCurrent(result, requestId, controller);
    if (current === undefined) return undefined;
    if (result.revision < acceptedRevision) {
      return staleRevisionFailure(result.revision, acceptedRevision);
    }
    acceptedRevision = result.revision;
    return current;
  }

  function completeCurrent<T>(
    result: WorkbenchResult<T>,
    requestId: number,
    controller: AbortController
  ): WorkbenchResult<T> | undefined {
    return isCurrentRequest(requestId, latestRequestId, controller) ? result : undefined;
  }

  return {
    loadCatalog: () => request(WORKBENCH_API.catalog, 'GET', readWorkbenchCatalog),
    loadComparison: (semanticKey) =>
      request(
        withSemanticKey(WORKBENCH_API.comparison, semanticKey),
        'GET',
        readComparisonDiagnostic,
        semanticKey
      ),
    refreshComparison: (semanticKey) =>
      request(
        withSemanticKey(WORKBENCH_API.refresh, semanticKey),
        'POST',
        readComparisonDiagnostic,
        semanticKey
      ),
    cancelActive: () => {
      latestRequestId += 1;
      activeController?.abort();
      activeController = undefined;
    },
    getRequestState: () => ({ latestRequestId, acceptedRevision }),
  };
}

function resolveUrl(baseUrl: string, route: string): string {
  if (baseUrl.length === 0) return route;
  return new URL(route, baseUrl).toString();
}

function withSemanticKey(route: string, semanticKey: string): string {
  const query = new URLSearchParams({ semanticKey });
  return `${route}?${query.toString()}`;
}

function isCurrentRequest(
  requestId: number,
  latestRequestId: number,
  controller: AbortController
): boolean {
  return requestId === latestRequestId && !controller.signal.aborted;
}

function parseJson(
  text: string
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

function readWorkbenchResult<T>(
  value: unknown,
  readValue: (value: unknown, revision: number) => T | undefined
): WorkbenchResult<T> | undefined {
  if (!isRecord(value) || typeof value['ok'] !== 'boolean' || !isRevision(value['revision'])) {
    return undefined;
  }
  const revision = value['revision'];
  if (value['ok']) {
    if (!('value' in value)) return undefined;
    const resultValue = readValue(value['value'], revision);
    return resultValue === undefined ? undefined : { ok: true, revision, value: resultValue };
  }
  const error = readDiagnosticError(value['error']);
  return error === undefined ? undefined : { ok: false, revision, error };
}

function readEnvelopeRevision(value: unknown): number | undefined {
  return isRecord(value) && isRevision(value['revision']) ? value['revision'] : undefined;
}

function readWorkbenchCatalog(
  value: unknown,
  envelopeRevision: number
): WorkbenchCatalog | undefined {
  if (!isRecord(value) || value['title'] !== 'Infra-bridge Reconstruction Workbench') {
    return undefined;
  }
  const products = value['products'];
  const reference = value['reference'];
  const sourceRevision = value['sourceRevision'];
  if (
    !Array.isArray(products) ||
    !isRecord(reference) ||
    !isRevision(sourceRevision) ||
    sourceRevision !== envelopeRevision
  ) {
    return undefined;
  }
  const decodedProducts: WorkbenchCatalog['products'][number][] = [];
  for (const product of products) {
    const decoded = readWorkbenchProduct(product);
    if (decoded === undefined) return undefined;
    decodedProducts.push(decoded);
  }
  const path = reference['path'];
  const fileName = reference['fileName'];
  const expectedChecksum = reference['expectedChecksum'];
  const productCount = reference['productCount'];
  if (
    typeof path !== 'string' ||
    typeof fileName !== 'string' ||
    typeof expectedChecksum !== 'string' ||
    !isRevision(productCount)
  ) {
    return undefined;
  }
  return {
    title: 'Infra-bridge Reconstruction Workbench',
    products: decodedProducts,
    reference: { path, fileName, expectedChecksum, productCount },
    sourceRevision,
  };
}

function readWorkbenchProduct(value: unknown): WorkbenchCatalog['products'][number] | undefined {
  if (!isRecord(value)) return undefined;
  const semanticKey = value['semanticKey'];
  const group = value['group'];
  const label = value['label'];
  const detail = value['detail'];
  if (
    typeof semanticKey !== 'string' ||
    typeof group !== 'string' ||
    typeof label !== 'string' ||
    typeof detail !== 'string'
  ) {
    return undefined;
  }
  return { semanticKey, group, label, detail };
}

function readComparisonDiagnostic(
  value: unknown,
  envelopeRevision: number
): ComparisonDiagnostic | undefined {
  return isComparisonDiagnostic(value) && value.revision === envelopeRevision ? value : undefined;
}

function isComparisonDiagnostic(value: unknown): value is ComparisonDiagnostic {
  if (
    !isRecord(value) ||
    typeof value['semanticKey'] !== 'string' ||
    !isRevision(value['revision']) ||
    !isFiniteNumber(value['durationMs']) ||
    typeof value['computedAt'] !== 'string' ||
    value['coordinateSpace'] !== 'canonical-component-local' ||
    !isRecord(value['surfaces']) ||
    !isRecord(value['frames']) ||
    !isRecord(value['frameDeltas']) ||
    !isDiagnosticScore(value['score']) ||
    !Array.isArray(value['gates']) ||
    !value['gates'].every(isDiagnosticGate) ||
    typeof value['pass'] !== 'boolean'
  ) {
    return false;
  }
  const surfaces = value['surfaces'];
  const frames = value['frames'];
  const frameDeltas = value['frameDeltas'];
  if (!isDiagnosticSurface(surfaces['reference']) || !isDiagnosticSurface(surfaces['candidate'])) {
    return false;
  }
  if (
    !isDiagnosticFrame(frames['referenceLocal']) ||
    !isDiagnosticFrame(frames['referenceWorld']) ||
    !isDiagnosticFrame(frames['canonicalWorld']) ||
    !isDiagnosticFrame(frames['candidateLocal']) ||
    !isDiagnosticFrame(frames['candidateWorld'])
  ) {
    return false;
  }
  return (
    isFiniteNumber(frameDeltas['controlPointDeltaMm']) &&
    isFiniteNumber(frameDeltas['xAxisDeltaDegrees']) &&
    isFiniteNumber(frameDeltas['zAxisDeltaDegrees'])
  );
}

function isDiagnosticGate(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isDiagnosticGateId(value['id']) &&
    (value['value'] === null || isFiniteNumber(value['value'])) &&
    isFiniteNumber(value['threshold']) &&
    (value['relation'] === 'at-most' || value['relation'] === 'at-least') &&
    (value['unit'] === 'millimetre' || value['unit'] === 'degree' || value['unit'] === 'ratio') &&
    (value['status'] === 'pass' ||
      value['status'] === 'fail' ||
      value['status'] === 'not-applicable' ||
      value['status'] === 'unavailable')
  );
}

function isDiagnosticGateId(value: unknown): boolean {
  return (
    value === 'frame-control-point' ||
    value === 'frame-x-axis' ||
    value === 'frame-z-axis' ||
    value === 'envelope-maximum' ||
    value === 'surface-p95' ||
    value === 'surface-maximum' ||
    value === 'normal-mean' ||
    value === 'volume-relative-error'
  );
}

function isDiagnosticScore(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const surfaceDistance = value['surfaceDistance'];
  const normalAgreement = value['normalAgreement'];
  const envelope = value['envelope'];
  if (!isRecord(surfaceDistance) || !isRecord(normalAgreement) || !isRecord(envelope)) {
    return false;
  }
  const deltas = envelope['deltasMm'];
  if (!isRecord(deltas)) return false;
  const volume = value['volume'];
  const closedSolidIoU = value['closedSolidIoU'];
  return (
    isFiniteNumber(surfaceDistance['maximumMm']) &&
    isFiniteNumber(surfaceDistance['meanMm']) &&
    isFiniteNumber(surfaceDistance['p95Mm']) &&
    isRevision(surfaceDistance['areaSampleCount']) &&
    isFiniteNumber(normalAgreement['meanCosine']) &&
    isFiniteNumber(normalAgreement['minimumCosine']) &&
    isFiniteNumber(deltas['xMin']) &&
    isFiniteNumber(deltas['xMax']) &&
    isFiniteNumber(deltas['yMin']) &&
    isFiniteNumber(deltas['yMax']) &&
    isFiniteNumber(deltas['zMin']) &&
    isFiniteNumber(deltas['zMax']) &&
    isFiniteNumber(envelope['maximumAbsoluteDeltaMm']) &&
    (volume === undefined || isDiagnosticVolume(volume)) &&
    (closedSolidIoU === undefined || isClosedSolidIoU(closedSolidIoU))
  );
}

function isDiagnosticVolume(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value['targetMm3']) &&
    isFiniteNumber(value['candidateMm3']) &&
    isFiniteNumber(value['relativeError'])
  );
}

function isClosedSolidIoU(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value['value']) &&
    (value['method'] === 'exact-envelope' || value['method'] === 'voxel-32')
  );
}

function isDiagnosticFrame(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteVector(value['origin']) &&
    isFiniteVector(value['xAxis']) &&
    isFiniteVector(value['zAxis'])
  );
}

function isDiagnosticSurface(value: unknown): boolean {
  if (!isRecord(value) || value['unit'] !== 'millimetre' || typeof value['closed'] !== 'boolean') {
    return false;
  }
  const vertices = value['vertices'];
  const triangles = value['triangles'];
  return (
    Array.isArray(vertices) &&
    vertices.every(isFiniteVector) &&
    Array.isArray(triangles) &&
    triangles.every(
      (triangle) => isIndexTriple(triangle) && triangle.every((index) => index < vertices.length)
    )
  );
}

function isFiniteVector(value: unknown): value is readonly [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}

function isIndexTriple(value: unknown): value is readonly [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((index) => Number.isSafeInteger(index) && index >= 0)
  );
}

function readDiagnosticError(value: unknown): WorkbenchDiagnosticError | undefined {
  if (!isRecord(value)) return undefined;
  const stage = value['stage'];
  const context = value['context'];
  if (
    !isWorkbenchErrorStage(stage) ||
    typeof value['code'] !== 'string' ||
    typeof value['message'] !== 'string' ||
    !isDiagnosticContext(context) ||
    typeof value['retryable'] !== 'boolean' ||
    typeof value['action'] !== 'string'
  ) {
    return undefined;
  }
  return {
    stage,
    code: value['code'],
    message: value['message'],
    context,
    retryable: value['retryable'],
    action: value['action'],
  };
}

function expectedSemanticKeyMismatch<T>(
  result: WorkbenchResult<T>,
  expectedSemanticKey: string | undefined
): WorkbenchResult<T> | undefined {
  if (!result.ok || expectedSemanticKey === undefined) return undefined;
  const value = result.value;
  const actualSemanticKey = isRecord(value) ? value['semanticKey'] : undefined;
  if (actualSemanticKey === expectedSemanticKey) return undefined;
  return transportFailure(
    result.revision,
    'semantic-key-mismatch',
    'The workbench server returned a comparison for a different Semantic Key.',
    {
      expectedSemanticKey,
      actualSemanticKey: typeof actualSemanticKey === 'string' ? actualSemanticKey : null,
    },
    'Retry the selected component. If the mismatch repeats, restart the workbench server.'
  );
}

function transportFailure<T>(
  revision: number,
  code: string,
  message: string,
  context: Readonly<Record<string, DiagnosticContextValue>>,
  action: string
): WorkbenchResult<T> {
  return {
    ok: false,
    revision,
    error: {
      stage: 'configuration',
      code,
      message,
      context,
      retryable: true,
      action,
    },
  };
}

function staleRevisionFailure<T>(
  responseRevision: number,
  acceptedRevision: number
): WorkbenchResult<T> {
  return transportFailure(
    responseRevision,
    'stale-revision-response',
    'The workbench server returned an older source revision than the browser has already accepted.',
    { responseRevision, acceptedRevision },
    'Retry the selected component. If the stale response repeats, restart the workbench server.'
  );
}

function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isWorkbenchErrorStage(value: unknown): value is WorkbenchErrorStage {
  return (
    value === 'configuration' ||
    value === 'reference-file' ||
    value === 'checksum' ||
    value === 'reference-decode' ||
    value === 'authored-evaluation' ||
    value === 'topology' ||
    value === 'scoring'
  );
}

function isDiagnosticContext(
  value: unknown
): value is Readonly<Record<string, DiagnosticContextValue>> {
  return isRecord(value) && Object.values(value).every(isDiagnosticContextValue);
}

function isDiagnosticContextValue(value: unknown): value is DiagnosticContextValue {
  return (
    value === null ||
    typeof value === 'string' ||
    isFiniteNumber(value) ||
    typeof value === 'boolean'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
