import {
  clone,
  err,
  fuse,
  getEdges,
  getFaces,
  getShapeKind,
  getShells,
  getSolids,
  getVertices,
  getWires,
  isCompound,
  isSolid,
  isValidSolid,
  measureVolume,
  ok,
  validSolid,
  type Result,
  type ValidSolid,
} from 'brepjs';
import { geometryError, specError, type BimError } from '../errors/bimError.js';

export type NonEmpty<T> = readonly [T, ...T[]];

export type ProductBody =
  | { readonly kind: 'PARAMETRIC'; readonly items: NonEmpty<ValidSolid> }
  | { readonly kind: 'AUTHORITATIVE'; readonly items: NonEmpty<ValidSolid> };

/** Returns borrowed Product-local items. Retaining an item requires an independent clone. */
export function bodySolids(body: ProductBody): NonEmpty<ValidSolid> {
  return body.items;
}

/** Validates and protects the container without taking ownership of its handles. */
export function prepareProductBody(
  body: ProductBody,
  ownedItems: ReadonlySet<ValidSolid> = new Set()
): Result<ProductBody, BimError> {
  let kind: ProductBody['kind'];
  let items: readonly ValidSolid[];
  try {
    if (body === null || typeof body !== 'object') {
      return err(
        specError('BODY_AUTHORITY_INVALID', 'Product Body must be an object with an authority')
      );
    }
    kind = body.kind;
    if (kind !== 'PARAMETRIC' && kind !== 'AUTHORITATIVE') {
      return err(specError('BODY_AUTHORITY_INVALID', 'Product Body authority is not supported'));
    }
    const suppliedItems = body.items;
    if (!Array.isArray(suppliedItems))
      return err(specError('BODY_ITEMS_INVALID', 'Product Body items must be an array'));
    items = [...suppliedItems];
  } catch (cause) {
    return err(specError('BODY_ITEMS_INVALID', 'Product Body input could not be read', cause));
  }
  const first = items[0];
  if (first === undefined)
    return err(specError('BODY_EMPTY', 'Product Body requires at least one item'));
  const identities = new Set<ValidSolid>();
  for (const [itemIndex, item] of items.entries()) {
    if (identities.has(item)) {
      return err(
        specError('BODY_DUPLICATE_ITEM', `Product Body item ${itemIndex} duplicates a handle`)
      );
    }
    identities.add(item);
    if (ownedItems.has(item)) {
      return err(
        specError(
          'BODY_ITEM_OWNERSHIP_CONFLICT',
          `Product Body item ${itemIndex} is already owned by this model`
        )
      );
    }
    try {
      if (item.disposed)
        return err(specError('BODY_ITEM_DISPOSED', `Product Body item ${itemIndex} is disposed`));
      if (!isSolid(item) || !isValidSolid(item)) {
        return err(
          specError('BODY_ITEM_INVALID', `Product Body item ${itemIndex} is not a valid solid`)
        );
      }
    } catch (cause) {
      return err(
        specError(
          'BODY_ITEM_INVALID',
          `Product Body item ${itemIndex} could not be validated`,
          cause
        )
      );
    }
  }
  const protectedItems: NonEmpty<ValidSolid> = Object.freeze([first, ...items.slice(1)]);
  return ok(Object.freeze({ kind, items: protectedItems }));
}

/** Owner cleanup. Borrowers must never dispose these items. */
export function disposeProductBody(body: ProductBody): void {
  for (const item of body.items) item[Symbol.dispose]();
}

/** Consumes a newly generated shape and requires a nonempty validated Body. */
export function productBodyFromOwnedShape(
  kind: ProductBody['kind'],
  shape: ValidSolid
): Result<ProductBody, BimError> {
  const normalized = productBodyItemsFromOwnedShape(shape);
  if (!normalized.ok) return normalized;
  const [first, ...remaining] = normalized.value;
  if (first === undefined)
    return err(geometryError('BODY_EMPTY', 'Generated shape has no solid Body items'));
  const prepared = prepareProductBody({ kind, items: [first, ...remaining] });
  if (!prepared.ok) for (const item of normalized.value) item[Symbol.dispose]();
  return prepared;
}

/** Consumes a generated shape. An empty cut yields no items; retained components are owned copies. */
export function productBodyItemsFromOwnedShape(
  shape: ValidSolid
): Result<readonly ValidSolid[], BimError> {
  if (isSolid(shape)) return ok([shape]);
  const owned: ValidSolid[] = [];
  let transferred = false;
  try {
    if (!isCompound(shape) && getShapeKind(shape) !== 'compsolid') {
      return err(
        geometryError('BODY_ITEM_INVALID', 'Generated shape is not a solid or aggregate of solids')
      );
    }
    const sources = getSolids(shape);
    if (
      sources.length === 0 &&
      (!isCompound(shape) ||
        getShells(shape).length > 0 ||
        getFaces(shape).length > 0 ||
        getWires(shape).length > 0 ||
        getEdges(shape).length > 0 ||
        getVertices(shape).length > 0)
    ) {
      return err(geometryError('BODY_ITEM_INVALID', 'Generated shape contains non-solid topology'));
    }
    for (const source of sources) {
      const copied = clone(source);
      if (!copied.ok)
        return err(
          geometryError(
            'BODY_ITEM_COPY_FAILED',
            'Generated Body item could not be copied',
            copied.error
          )
        );
      let checked: ReturnType<typeof validSolid>;
      try {
        checked = validSolid(copied.value);
      } catch (cause) {
        copied.value[Symbol.dispose]();
        throw cause;
      }
      if (!checked.ok) {
        copied.value[Symbol.dispose]();
        return err(
          geometryError('BODY_ITEM_INVALID', 'Generated Body item is invalid', checked.error)
        );
      }
      owned.push(checked.value);
    }
    transferred = true;
    return ok(owned);
  } catch (cause) {
    return err(
      geometryError('BODY_ITEM_COPY_FAILED', 'Generated Body items could not be copied', cause)
    );
  } finally {
    shape[Symbol.dispose]();
    if (!transferred) for (const item of owned) item[Symbol.dispose]();
  }
}

export interface ProductBodyVolumeDependencies {
  readonly fuse?: typeof fuse | undefined;
  readonly measure?: typeof measureVolume | undefined;
}

/** Measures occupied material in mm³ without changing the borrowed items or their order. */
export function measureProductBodyVolume(
  body: ProductBody,
  dependencies: ProductBodyVolumeDependencies = {}
): Result<number, BimError> {
  const unionItems = dependencies.fuse ?? fuse;
  const measure = dependencies.measure ?? measureVolume;
  const [first, ...remaining] = body.items;
  let union: ValidSolid | null = null;
  try {
    for (const item of remaining) {
      const combined: Result<ValidSolid> = unionItems(union ?? first, item, {
        trackEvolution: false,
      });
      if (!combined.ok) return volumeUnavailable(combined.error);
      const previous = union;
      union = combined.value;
      previous?.[Symbol.dispose]();
    }
    const measured = measure(union ?? first);
    if (!measured.ok) return volumeUnavailable(measured.error);
    if (!Number.isFinite(measured.value) || measured.value <= 0) {
      return volumeUnavailable(new Error(`Occupied material volume was ${measured.value}`));
    }
    return ok(measured.value);
  } catch (cause) {
    return volumeUnavailable(cause);
  } finally {
    union?.[Symbol.dispose]();
  }
}

function volumeUnavailable(cause: unknown): Result<never, BimError> {
  return err(
    geometryError(
      'BODY_VOLUME_UNAVAILABLE',
      'Product Body occupied material volume could not be measured',
      cause
    )
  );
}
