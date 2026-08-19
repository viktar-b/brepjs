import { err, ok, type Result } from 'brepjs';
import type { ResolvedElement } from 'brepjs-families';
import type { BimError } from './errors/bimError.js';
import { specError } from './errors/bimError.js';
import type { LocalId } from './identity/localId.js';
import type { BimModel } from './model/bimModel.js';
import type { ProjectSpec } from './specs/spatialSpec.js';

export interface FamiliesToBimOptions {
  readonly project: ProjectSpec;
  readonly siteName?: string | undefined;
  readonly buildingName?: string | undefined;
}

export interface FamiliesBimResult {
  readonly model: BimModel;
  /** LocalId per projected Semantic Key path, including spatial identities. */
  readonly idByKeyPath: ReadonlyMap<string, LocalId>;
}

/** Every element that mints an IFC identity needs an explicit Semantic Key. */
export function requireKeyed(el: ResolvedElement): Result<void, BimError> {
  if (el.keyed) return ok(undefined);
  return err(
    specError(
      'FAMILIES_UNKEYED_ELEMENT',
      `familiesToBim: '${el.keyPath}' has no explicit key — IFC identity needs order-independent key paths (add a key to the element)`
    )
  );
}
