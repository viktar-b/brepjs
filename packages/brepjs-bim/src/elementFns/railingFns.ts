import { generateGeometry } from '../geometryGeneration.js';
import { reportedGeometryCleanup } from '../geometryCleanupDiagnostics.js';
import { validateGeneratedSolid } from './validateGeneratedSolid.js';
import { polygon, extrude, box, fuse, isValidSolid, getSolids, clone } from 'brepjs';
import type { ValidSolid, Result } from 'brepjs';
import { err } from 'brepjs';
import type { RailingSpec } from '../specs/railingSpec.js';
import type { BimError } from '../errors/bimError.js';
import { specError, fromBrepError, geometryError } from '../errors/bimError.js';
import { cleanupOwnedResources, cleanupReport } from '../productBodyCleanup.js';

// PANEL (default): a rectangular rail cross-section (thickness × height) in the
// local YZ plane swept along +X by the run length — a single extrusion.
function panelRailing(spec: RailingSpec): Result<ValidSolid, BimError> {
  return generateGeometry({ operation: 'railingToSolid', codePrefix: 'RAILING' }, (own) => {
    const { length, height, thickness } = spec;
    const profileResult = polygon([
      [0, 0, 0],
      [0, thickness, 0],
      [0, thickness, height],
      [0, 0, height],
    ]);
    if (!profileResult.ok) {
      return err(
        fromBrepError(
          profileResult.error,
          'RAILING_PROFILE_FAILED',
          'Failed to create railing profile'
        )
      );
    }
    const profile = own(profileResult.value);
    const solidResult = extrude(profile, [length, 0, 0]);
    if (!solidResult.ok) {
      return err(
        fromBrepError(
          solidResult.error,
          'RAILING_EXTRUDE_FAILED',
          'Failed to sweep railing profile'
        )
      );
    }
    const solid = own(solidResult.value);
    return validateGeneratedSolid(solid, {
      code: 'RAILING_INVALID_SOLID',
      message: 'Swept railing solid failed validity check',
    });
  });
}

// POSTED: vertical square posts (every ~1m) plus a top and bottom rail spanning
// the run, all square bars of side `thickness`, fused into one solid. Every
// intermediate box is disposed on success and on failure (mirrors the
// curtainWallFns disposal discipline). Envelope matches PANEL: x∈[0,length],
// y∈[0,thickness], z∈[0,height].
function buildPostedRailing(
  spec: RailingSpec,
  owned: Set<ValidSolid>
): Result<ValidSolid, BimError> {
  const { length, height, thickness: t } = spec;
  const boxes: ValidSolid[] = [];
  const retain = (solid: ValidSolid): void => {
    owned.add(solid);
    boxes.push(solid);
  };
  const postCount = Math.max(2, Math.round(length / 1000) + 1);
  for (let i = 0; i < postCount; i++) {
    const x = t / 2 + (length - t) * (i / (postCount - 1));
    retain(box(t, t, height, { at: [x, t / 2, height / 2], centered: true }));
  }
  for (const z of [height - t / 2, t / 2]) {
    retain(box(length, t, t, { at: [length / 2, t / 2, z], centered: true }));
  }
  let accumulated: ValidSolid | undefined;
  for (const part of boxes) {
    if (accumulated === undefined) {
      accumulated = part;
      continue;
    }
    const fused = fuse(accumulated, part, { trackEvolution: false });
    if (!fused.ok)
      return err(fromBrepError(fused.error, 'RAILING_FUSE_FAILED', 'Failed to fuse railing parts'));
    accumulated = fused.value;
    owned.add(accumulated);
  }
  if (accumulated === undefined)
    return err(geometryError('RAILING_INVALID_SOLID', 'Posted railing produced no solid'));
  // A Boolean may wrap the connected result in a compound. Its cached subsolid
  // belongs to that compound; the returned recipe item must be an independent owner.
  const solids = getSolids(accumulated);
  const [solid] = solids;
  if (solids.length !== 1 || solid === undefined || !isValidSolid(solid)) {
    return err(
      geometryError(
        'RAILING_INVALID_SOLID',
        'Posted railing must contain one valid connected solid'
      )
    );
  }
  const copied = clone(solid);
  if (!copied.ok)
    return err(
      fromBrepError(copied.error, 'RAILING_COPY_FAILED', 'Failed to retain posted railing solid')
    );
  owned.add(copied.value);
  return copied;
}

function postedRailing(spec: RailingSpec): Result<ValidSolid, BimError> {
  // Command-owned resources are registered immediately and released even when a
  // native operation throws. No output escapes before temporary cleanup succeeds.
  const owned = new Set<ValidSolid>();
  const context = { operation: 'railingToSolid', itemIndex: 0 };
  let result: Result<ValidSolid, BimError>;
  try {
    result = buildPostedRailing(spec, owned);
  } catch (cause) {
    result = err(geometryError('RAILING_BUILD_FAILED', 'Failed to generate posted railing', cause));
  }
  const survivor = result.ok ? result.value : undefined;
  const resources = [...owned].map((resource, itemIndex) => ({ resource, itemIndex }));
  const cleanup = cleanupOwnedResources(
    resources.filter(({ resource }) => resource !== survivor),
    context
  );
  const diagnostics = [
    ...(result.ok ? [] : reportedGeometryCleanup(result.error, context.operation)),
    ...(cleanup.kind === 'FAILED' ? cleanup.diagnostics : []),
  ];
  if (!result.ok)
    return err({ ...result.error, metadata: { cleanup: cleanupReport(diagnostics) } });
  if (diagnostics.length === 0) return result;
  const outputCleanup = cleanupOwnedResources(
    resources.filter(({ resource }) => resource === survivor),
    context
  );
  if (outputCleanup.kind === 'FAILED') diagnostics.push(...outputCleanup.diagnostics);
  return err({
    ...geometryError('RAILING_CLEANUP_FAILED', 'Posted railing temporary cleanup failed'),
    metadata: { cleanup: cleanupReport(diagnostics) },
  });
}

// Returned solid is unplaced template geometry in the local frame; origin/axisX/
// axisZ are applied downstream (IFC writer / placedSolids accessor). `infill`
// selects the geometry: PANEL (default, backward-compatible) or POSTED.
export function railingToSolid(spec: RailingSpec): Result<ValidSolid, BimError> {
  if (spec.length <= 0) {
    return err(specError('RAILING_ZERO_LENGTH', 'Railing length must be positive'));
  }
  if (spec.height <= 0) {
    return err(specError('RAILING_ZERO_HEIGHT', 'Railing height must be positive'));
  }
  if (spec.thickness <= 0) {
    return err(specError('RAILING_ZERO_THICKNESS', 'Railing thickness must be positive'));
  }
  return spec.infill === 'POSTED' ? postedRailing(spec) : panelRailing(spec);
}
