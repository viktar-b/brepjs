import { expect, it } from 'vitest';
import { loadReference, type ReconstructionTarget } from '@brepjs/infra-bridge-reference';
import {
  ANALYTIC_BREP_GLOBAL_ID,
  analyticBrepSha256,
  syntheticAnalyticBrepIfc,
} from './analyticBrepIfcFixture.js';
import {
  PARAMETRIC_MEMBER_GLOBAL_ID,
  parametricSha256,
  syntheticParametricIfc,
} from './parametricIfcFixture.js';
import {
  SYNTHETIC_MEMBER_GLOBAL_ID,
  sha256,
  syntheticTessellatedIfc,
} from './tessellatedIfcFixture.js';

it('converges tessellated, parametric, and analytic lanes on ReconstructionTarget', async () => {
  const cases = [
    [syntheticTessellatedIfc(), sha256, SYNTHETIC_MEMBER_GLOBAL_ID, 'tessellated'],
    [syntheticParametricIfc(), parametricSha256, PARAMETRIC_MEMBER_GLOBAL_ID, 'parametric'],
    [syntheticAnalyticBrepIfc(), analyticBrepSha256, ANALYTIC_BREP_GLOBAL_ID, 'analytic'],
  ] as const;
  const targets: ReconstructionTarget[] = [];
  for (const [bytes, digest, referenceGlobalId, semanticKey] of cases) {
    const result = await loadReference({
      bytes,
      manifest: { checksum: digest(bytes), mappings: [{ semanticKey, referenceGlobalId }] },
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.targets[0] !== undefined) {
      targets.push(result.value.targets[0]);
    }
  }

  expect(targets).toHaveLength(3);
  for (const target of targets) {
    expect(target).toHaveProperty('semanticKey');
    expect(target.comparisonSurface).toMatchObject({ unit: 'millimetre', closed: true });
    expect(JSON.stringify(target)).not.toMatch(
      /Ifc|ExpressId|GlobalId|CoordIndex|ExtrudedArea|AdvancedBrep/
    );
  }
});
