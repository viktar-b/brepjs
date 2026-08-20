import type {
  ComparisonDiagnostic,
  DiagnosticGate,
  DiagnosticGateId,
  DiagnosticVector,
} from '../shared/protocol.js';

export interface EvidenceLedgerProps {
  readonly diagnostic: ComparisonDiagnostic;
  readonly previous: boolean;
}

const GATE_LABELS: Readonly<Record<DiagnosticGateId, string>> = {
  'frame-control-point': 'Control point',
  'frame-x-axis': 'X-axis angle',
  'frame-z-axis': 'Z-axis angle',
  'envelope-maximum': 'Envelope maximum',
  'surface-p95': 'Surface P95',
  'surface-maximum': 'Surface maximum',
  'normal-mean': 'Normal mean',
  'volume-relative-error': 'Volume error',
};

export function EvidenceLedger({ diagnostic, previous }: EvidenceLedgerProps) {
  const gates = new Map(diagnostic.gates.map((gate) => [gate.id, gate]));
  const envelope = diagnostic.score.envelope.deltasMm;
  const volume = diagnostic.score.volume;
  const iou = diagnostic.score.closedSolidIoU;

  return (
    <details className="evidence-pane" open>
      <summary>
        <span>Fidelity evidence</span>
        <OutcomeBadge pass={diagnostic.pass} />
      </summary>
      <div className="evidence-scroll">
        {previous && (
          <div className="previous-result" role="status">
            <span className="pulse-dot" aria-hidden="true" />
            Previous successful result
          </div>
        )}

        <section className="evidence-section" aria-labelledby="frame-evidence-title">
          <SectionHeading id="frame-evidence-title" index="01" title="Frame" />
          <MetricRow
            label="Control point"
            value={formatNumber(diagnostic.frameDeltas.controlPointDeltaMm, 'millimetre')}
            gate={gates.get('frame-control-point')}
          />
          <MetricRow
            label="X-axis angle"
            value={formatNumber(diagnostic.frameDeltas.xAxisDeltaDegrees, 'degree')}
            gate={gates.get('frame-x-axis')}
          />
          <MetricRow
            label="Z-axis angle"
            value={formatNumber(diagnostic.frameDeltas.zAxisDeltaDegrees, 'degree')}
            gate={gates.get('frame-z-axis')}
          />
          <FrameReadout label="Reference origin" value={diagnostic.frames.canonicalWorld.origin} />
          <FrameReadout label="Candidate origin" value={diagnostic.frames.candidateWorld.origin} />
          <FrameReadout label="Reference X" value={diagnostic.frames.canonicalWorld.xAxis} />
          <FrameReadout label="Candidate X" value={diagnostic.frames.candidateWorld.xAxis} />
          <FrameReadout label="Reference Z" value={diagnostic.frames.canonicalWorld.zAxis} />
          <FrameReadout label="Candidate Z" value={diagnostic.frames.candidateWorld.zAxis} />
        </section>

        <section className="evidence-section" aria-labelledby="envelope-evidence-title">
          <SectionHeading id="envelope-evidence-title" index="02" title="Envelope" />
          <MetricRow
            label="Envelope maximum"
            value={formatNumber(diagnostic.score.envelope.maximumAbsoluteDeltaMm, 'millimetre')}
            gate={gates.get('envelope-maximum')}
          />
          <DeltaGrid deltas={envelope} />
        </section>

        <section className="evidence-section" aria-labelledby="surface-evidence-title">
          <SectionHeading id="surface-evidence-title" index="03" title="Surface" />
          <MetricRow
            label="Surface maximum"
            value={formatNumber(diagnostic.score.surfaceDistance.maximumMm, 'millimetre')}
            gate={gates.get('surface-maximum')}
          />
          <MetricRow
            label="Surface mean"
            value={formatNumber(diagnostic.score.surfaceDistance.meanMm, 'millimetre')}
          />
          <MetricRow
            label="Surface P95"
            value={formatNumber(diagnostic.score.surfaceDistance.p95Mm, 'millimetre')}
            gate={gates.get('surface-p95')}
          />
          <MetricRow
            label="Area samples"
            value={diagnostic.score.surfaceDistance.areaSampleCount.toLocaleString('en-US')}
          />
        </section>

        <section className="evidence-section" aria-labelledby="normal-evidence-title">
          <SectionHeading id="normal-evidence-title" index="04" title="Normals" />
          <MetricRow
            label="Normal mean"
            value={formatNumber(diagnostic.score.normalAgreement.meanCosine, 'ratio')}
            gate={gates.get('normal-mean')}
          />
          <MetricRow
            label="Normal minimum"
            value={formatNumber(diagnostic.score.normalAgreement.minimumCosine, 'ratio')}
          />
        </section>

        <section className="evidence-section" aria-labelledby="solid-evidence-title">
          <SectionHeading id="solid-evidence-title" index="05" title="Solid" />
          <MetricRow
            label="Reference volume"
            value={volume === undefined ? 'Unavailable' : formatVolume(volume.targetMm3)}
          />
          <MetricRow
            label="Candidate volume"
            value={volume === undefined ? 'Unavailable' : formatVolume(volume.candidateMm3)}
          />
          <MetricRow
            label="Volume error"
            value={
              volume === undefined ? 'Unavailable' : formatNumber(volume.relativeError, 'ratio')
            }
            gate={gates.get('volume-relative-error')}
          />
          <MetricRow
            label="Closed-solid IoU"
            value={iou === undefined ? 'Not available' : formatNumber(iou.value, 'ratio')}
            note={iou?.method}
          />
        </section>
      </div>
    </details>
  );
}

function SectionHeading({ id, index, title }: { id: string; index: string; title: string }) {
  return (
    <div className="section-heading">
      <span>{index}</span>
      <h2 id={id}>{title}</h2>
    </div>
  );
}

function MetricRow({
  label,
  value,
  gate,
  note,
}: {
  label: string;
  value: string;
  gate?: DiagnosticGate | undefined;
  note?: string | undefined;
}) {
  return (
    <div className="metric-row">
      <div className="metric-name">
        <span>{label}</span>
        {note !== undefined && <small>{note}</small>}
      </div>
      <span className="metric-value">{value}</span>
      {gate === undefined ? (
        <span className="metric-status metric-status--evidence">Evidence</span>
      ) : (
        <GateStatus gate={gate} />
      )}
    </div>
  );
}

function GateStatus({ gate }: { gate: DiagnosticGate }) {
  const relation = gate.relation === 'at-most' ? '≤' : '≥';
  const label =
    gate.status === 'pass'
      ? 'Pass'
      : gate.status === 'fail'
        ? 'Fail'
        : gate.status === 'not-applicable'
          ? 'N/A'
          : 'Unavailable';
  return (
    <span className={`metric-status metric-status--${gate.status}`}>
      <span>{label}</span>
      <small>
        {relation} {formatNumber(gate.threshold, gate.unit)}
      </small>
    </span>
  );
}

function FrameReadout({ label, value }: { label: string; value: DiagnosticVector }) {
  return (
    <div className="frame-readout">
      <span>{label}</span>
      <code>{value.map((coordinate) => formatPlain(coordinate)).join(' · ')}</code>
    </div>
  );
}

function DeltaGrid({ deltas }: { deltas: ComparisonDiagnostic['score']['envelope']['deltasMm'] }) {
  return (
    <div className="delta-grid" aria-label="Signed envelope deltas">
      {(
        [
          ['X min', deltas.xMin],
          ['X max', deltas.xMax],
          ['Y min', deltas.yMin],
          ['Y max', deltas.yMax],
          ['Z min', deltas.zMin],
          ['Z max', deltas.zMax],
        ] as const
      ).map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <code>{formatNumber(value, 'millimetre')}</code>
        </div>
      ))}
    </div>
  );
}

function OutcomeBadge({ pass }: { pass: boolean }) {
  return (
    <span className={`outcome-badge outcome-badge--${pass ? 'pass' : 'fail'}`}>
      <span aria-hidden="true">{pass ? '✓' : '!'}</span>
      {pass ? 'All gates pass' : 'Gate attention'}
    </span>
  );
}

function formatNumber(value: number, unit: DiagnosticGate['unit']): string {
  const digits = unit === 'degree' ? 4 : unit === 'ratio' ? 5 : Math.abs(value) < 1 ? 3 : 2;
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
  return `${formatted} ${unit === 'millimetre' ? 'mm' : unit === 'degree' ? '°' : ''}`.trim();
}

function formatVolume(value: number): string {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)} mm³`;
}

function formatPlain(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value);
}

export { GATE_LABELS };
