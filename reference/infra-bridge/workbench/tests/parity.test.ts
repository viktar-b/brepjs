import { describe, expect, it } from 'vitest';
import manifest from '../../referenceManifest.json';
import {
  collectFreshBatchComparisonEvidence,
  REPRESENTATIVE_COMPARISON_KEYS,
  type ComparisonReportRow,
} from '../../scripts/comparisonEvidence.js';
import type { DiagnosticScore } from '../shared/protocol.js';
import {
  assertComparisonMatchesBatch,
  assertComparisonMatchesGolden,
  loadComparisonGolden,
  parseFreshBatchComparisonEvidence,
  runFreshBatchComparison,
  type GoldenCase,
  type ParityDiagnosticEvidence,
} from '../scripts/parity.js';

describe('tracked batch/workbench comparison parity', () => {
  it('binds every representative golden case to the current Reference manifest', async () => {
    const golden = await loadComparisonGolden();
    const manifestKeys = new Set(manifest.mappings.map(({ semanticKey }) => semanticKey));

    expect(golden.referenceChecksum).toBe(manifest.checksum);
    expect(golden.sourceReportSha256).toMatch(/^[a-f\d]{64}$/u);
    expect(golden.sourceNodeVersion).toMatch(/^24\./u);
    expect(Object.keys(golden.cases)).toEqual(['straight', 'curved', 'repeated', 'textBearing']);
    for (const comparisonCase of Object.values(golden.cases)) {
      expect(manifestKeys.has(comparisonCase.semanticKey)).toBe(true);
    }
  });

  it('accepts the independently recorded evidence within its explicit tolerances', async () => {
    const golden = await loadComparisonGolden();

    for (const comparisonCase of Object.values(golden.cases)) {
      expect(() => {
        assertComparisonMatchesGolden(
          evidenceFromGolden(comparisonCase),
          comparisonCase,
          golden.tolerances
        );
      }).not.toThrow();
    }
  });

  it('rejects surface drift beyond the tracked batch/workbench tolerance', async () => {
    const golden = await loadComparisonGolden();
    const expected = golden.cases.curved;
    const actual = evidenceFromGolden(expected);

    expect(() => {
      assertComparisonMatchesGolden(
        {
          ...actual,
          score: {
            ...actual.score,
            surfaceDistance: {
              ...actual.score.surfaceDistance,
              p95Mm: expected.surface[2] + golden.tolerances.surfaceMm * 1.01,
            },
          },
        },
        expected,
        golden.tolerances
      );
    }).toThrow(/surface p95/u);
  });

  it('compares current Workbench evidence directly with fresh batch evidence', async () => {
    const golden = await loadComparisonGolden();
    const batchEvidence = evidenceFromGolden(golden.cases.textBearing);

    expect(() => {
      assertComparisonMatchesBatch(
        evidenceFromGolden(golden.cases.textBearing),
        batchEvidence,
        golden.tolerances
      );
    }).not.toThrow();

    expect(() => {
      assertComparisonMatchesBatch(
        {
          ...batchEvidence,
          score: {
            ...batchEvidence.score,
            normalAgreement: {
              ...batchEvidence.score.normalAgreement,
              meanCosine:
                batchEvidence.score.normalAgreement.meanCosine + golden.tolerances.ratio * 1.01,
            },
          },
        },
        batchEvidence,
        golden.tolerances
      );
    }).toThrow(/normal mean/u);
  });

  it('packages the four named cases from actual batch report rows', async () => {
    const golden = await loadComparisonGolden();
    const rows = Object.values(golden.cases).map(reportRowFromGolden);
    const evidence = collectFreshBatchComparisonEvidence(rows, golden.referenceChecksum);

    expect(evidence).toEqual({
      schemaVersion: 1,
      referenceChecksum: golden.referenceChecksum,
      productCount: 4,
      cases: {
        straight: evidenceFromGolden(golden.cases.straight),
        curved: evidenceFromGolden(golden.cases.curved),
        repeated: evidenceFromGolden(golden.cases.repeated),
        textBearing: evidenceFromGolden(golden.cases.textBearing),
      },
    });
    expect(REPRESENTATIVE_COMPARISON_KEYS).toEqual(
      Object.fromEntries(
        Object.entries(golden.cases).map(([name, comparisonCase]) => [
          name,
          comparisonCase.semanticKey,
        ])
      )
    );
  });

  it('accepts only complete fresh batch evidence emitted by the CLI', async () => {
    const golden = await loadComparisonGolden();
    const evidence = collectFreshBatchComparisonEvidence(
      Object.values(golden.cases).map(reportRowFromGolden),
      golden.referenceChecksum
    );

    expect(parseFreshBatchComparisonEvidence(JSON.stringify(evidence))).toEqual(evidence);
    expect(() =>
      parseFreshBatchComparisonEvidence(
        JSON.stringify({ ...evidence, cases: { straight: evidence.cases.straight } })
      )
    ).toThrow(/fresh batch evidence/u);
  });

  it('aborts a fresh batch child through the caller deadline signal', async () => {
    const controller = new AbortController();
    controller.abort(new Error('parity deadline reached'));

    await expect(
      runFreshBatchComparison('/does/not/need/to/exist.ifc', {
        signal: controller.signal,
      })
    ).rejects.toThrow(/abort|deadline/iu);
  });
});

function evidenceFromGolden(comparisonCase: GoldenCase): ParityDiagnosticEvidence {
  const score: DiagnosticScore = {
    surfaceDistance: {
      maximumMm: comparisonCase.surface[0],
      meanMm: comparisonCase.surface[1],
      p95Mm: comparisonCase.surface[2],
      areaSampleCount: 1,
    },
    normalAgreement: {
      meanCosine: comparisonCase.normal[0],
      minimumCosine: comparisonCase.normal[1],
    },
    envelope: {
      deltasMm: {
        xMin: comparisonCase.envelope.xMin,
        xMax: comparisonCase.envelope.xMax,
        yMin: comparisonCase.envelope.yMin,
        yMax: comparisonCase.envelope.yMax,
        zMin: comparisonCase.envelope.zMin,
        zMax: comparisonCase.envelope.zMax,
      },
      maximumAbsoluteDeltaMm: comparisonCase.envelope.maximum,
    },
    volume: {
      targetMm3: comparisonCase.volume[0],
      candidateMm3: comparisonCase.volume[1],
      relativeError: comparisonCase.volume[2],
    },
    closedSolidIoU: { value: comparisonCase.iou, method: 'voxel-32' },
  };
  return {
    semanticKey: comparisonCase.semanticKey,
    frameDeltas: {
      controlPointDeltaMm: comparisonCase.frame[0],
      xAxisDeltaDegrees: comparisonCase.frame[1],
      zAxisDeltaDegrees: comparisonCase.frame[2],
    },
    score,
  };
}

function reportRowFromGolden(comparisonCase: GoldenCase): ComparisonReportRow {
  const evidence = evidenceFromGolden(comparisonCase);
  return {
    targetKey: evidence.semanticKey,
    candidateKey: evidence.semanticKey,
    ...evidence.frameDeltas,
    score: evidence.score,
    pass: true,
  };
}
