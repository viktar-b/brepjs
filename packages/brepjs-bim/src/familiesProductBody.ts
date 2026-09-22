import { err, getSolids, isSolid, ok, type Result, type Solid, type csg } from 'brepjs';
import type { ResolvedElement } from 'brepjs-families';
import { specError, type BimError } from './errors/bimError.js';
import { reportedGeometryCleanup } from './geometryCleanupDiagnostics.js';
import { cleanupReport, type CleanupReport } from './productBodyCleanup.js';
import {
  copyProductBody,
  disposeProductBody,
  transformProductBody,
  validateProductBody,
  type ProductBody,
} from './types/productBody.js';
import { frameInverse, type RigidFrame } from './placementFrame.js';

export interface CivilProductBodyInput {
  readonly element: ResolvedElement;
  readonly category: 'WALL' | 'RAILING';
  readonly evaluator: csg.Evaluator;
  readonly productWorldFrame: RigidFrame;
}

/**
 * Borrow evaluator/cache handles, then copy and inverse-localize in item order.
 * Every successful result is AUTHORITATIVE and caller-owned until COMMITTED.
 */
export function prepareCivilProductBody(
  input: CivilProductBodyInput
): Result<ProductBody, BimError> {
  const inverse = frameInverse(input.productWorldFrame);
  if (!inverse.ok)
    return err(
      productBodyError(
        input,
        'FAMILIES_PRODUCT_BODY_LOCALIZE_FAILED',
        'invalid Product frame',
        inverse.error
      )
    );
  const evaluated = evaluateBody(input);
  if (!evaluated.ok) return evaluated;
  if (evaluated.value.length === 0)
    return err(
      productBodyError(input, 'FAMILIES_PRODUCT_BODY_EMPTY', 'evaluated to no solid Body items')
    );
  const borrowed = validateProductBody({ kind: 'AUTHORITATIVE', solids: evaluated.value });
  if (!borrowed.ok)
    return err(
      productBodyError(
        input,
        'FAMILIES_PRODUCT_BODY_INVALID',
        'evaluated Body contains an invalid item',
        borrowed.error,
        borrowed.error.itemIndex
      )
    );

  const copied = copyProductBody(borrowed.value);
  if (!copied.ok)
    return err(
      productBodyError(
        input,
        'FAMILIES_PRODUCT_BODY_COPY_FAILED',
        'authored Body could not be copied',
        copied.error,
        copied.error.itemIndex
      )
    );
  const localized = transformProductBody(copied.value, inverse.value);
  // Shared operations own their outputs on failure. Only these successful copies
  // remain ours; failed releases are reported and never retried.
  const copyCleanup = disposeProductBody(copied.value);
  if (!localized.ok)
    return err(
      productBodyError(
        input,
        'FAMILIES_PRODUCT_BODY_LOCALIZE_FAILED',
        'authored Body could not be moved into the Product-local frame',
        localized.error,
        localized.error.itemIndex,
        [copyCleanup]
      )
    );
  if (copyCleanup.kind === 'FAILED') {
    const outputCleanup = disposeProductBody(localized.value);
    return err(
      productBodyError(
        input,
        'FAMILIES_PRODUCT_BODY_CLEANUP_FAILED',
        'temporary Body cleanup failed before adoption',
        undefined,
        undefined,
        [copyCleanup, outputCleanup]
      )
    );
  }
  return localized;
}

function evaluateBody(input: CivilProductBodyInput): Result<readonly Solid[], BimError> {
  try {
    const evaluated = input.evaluator.evaluate(input.element.geometry);
    if (!evaluated.ok)
      return err(
        productBodyError(
          input,
          'FAMILIES_PRODUCT_BODY_EVALUATION_FAILED',
          `authored Body evaluation failed: ${evaluated.error.message}`,
          evaluated.error
        )
      );
    return ok(isSolid(evaluated.value) ? [evaluated.value] : getSolids(evaluated.value));
  } catch (cause) {
    return err(
      productBodyError(
        input,
        'FAMILIES_PRODUCT_BODY_EVALUATION_FAILED',
        'authored Body evaluation threw',
        cause
      )
    );
  }
}

function productBodyError(
  input: CivilProductBodyInput,
  code: string,
  detail: string,
  cause?: unknown,
  itemIndex?: number,
  reports: readonly CleanupReport[] = []
): BimError {
  const error = specError(
    code,
    `familiesToBim: '${input.element.keyPath}' (${input.category}) ${detail}`,
    cause
  );
  return {
    ...error,
    metadata: {
      keyPath: input.element.keyPath,
      category: input.category,
      ...(itemIndex === undefined ? {} : { itemIndex }),
      cleanup: cleanupReport([
        ...reportedGeometryCleanup(error, 'prepareCivilProductBody'),
        ...reports.flatMap((report) => (report.kind === 'FAILED' ? report.diagnostics : [])),
      ]),
    },
  };
}
