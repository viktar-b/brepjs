import type { CandidateScore } from '../src/scoring.js';

export type RepresentativeComparisonName = 'straight' | 'curved' | 'repeated' | 'textBearing';

export const REPRESENTATIVE_COMPARISON_KEYS = {
  straight: 'infra-bridge/road-site/road-river-bridge/deck/bridge-deck',
  curved: 'infra-bridge/rail-site-01/rail-bridge-01/superstructure/arch-segment-01',
  repeated: 'infra-bridge/rail-site-02/rail-bridge-02/substructure/pier-01/footing',
  textBearing: 'infra-bridge/rail-site-01/rail-bridge-01/superstructure/name-sign-01',
} as const satisfies Readonly<Record<RepresentativeComparisonName, string>>;

export interface ComparisonReportRow {
  readonly targetKey: string;
  readonly candidateKey: string;
  readonly controlPointDeltaMm: number;
  readonly xAxisDeltaDegrees: number;
  readonly zAxisDeltaDegrees: number;
  readonly score: CandidateScore;
  readonly pass: boolean;
}

export interface BatchComparisonDiagnosticEvidence {
  readonly semanticKey: string;
  readonly frameDeltas: {
    readonly controlPointDeltaMm: number;
    readonly xAxisDeltaDegrees: number;
    readonly zAxisDeltaDegrees: number;
  };
  readonly score: CandidateScore;
}

export interface FreshBatchComparisonEvidence {
  readonly schemaVersion: 1;
  readonly referenceChecksum: string;
  readonly productCount: number;
  readonly cases: Readonly<Record<RepresentativeComparisonName, BatchComparisonDiagnosticEvidence>>;
}

/** Select compact representative evidence from the rows produced by the batch comparison CLI. */
export function collectFreshBatchComparisonEvidence(
  reports: readonly ComparisonReportRow[],
  referenceChecksum: string
): FreshBatchComparisonEvidence {
  const byKey = new Map(reports.map((report) => [report.targetKey, report]));
  const cases = Object.fromEntries(
    typedEntries(REPRESENTATIVE_COMPARISON_KEYS).map(([name, semanticKey]) => {
      const report = byKey.get(semanticKey);
      if (report === undefined) {
        throw new Error(`Batch comparison omitted representative Semantic Key: ${semanticKey}`);
      }
      if (report.candidateKey !== semanticKey) {
        throw new Error(
          `Batch comparison paired ${semanticKey} with Candidate ${report.candidateKey}`
        );
      }
      return [
        name,
        {
          semanticKey,
          frameDeltas: {
            controlPointDeltaMm: report.controlPointDeltaMm,
            xAxisDeltaDegrees: report.xAxisDeltaDegrees,
            zAxisDeltaDegrees: report.zAxisDeltaDegrees,
          },
          score: report.score,
        },
      ];
    })
  ) as Record<RepresentativeComparisonName, BatchComparisonDiagnosticEvidence>;
  return {
    schemaVersion: 1,
    referenceChecksum,
    productCount: reports.length,
    cases,
  };
}

function typedEntries<T extends Readonly<Record<string, unknown>>>(
  value: T
): { [K in keyof T]: readonly [K, T[K]] }[keyof T][] {
  return Object.entries(value) as { [K in keyof T]: readonly [K, T[K]] }[keyof T][];
}
