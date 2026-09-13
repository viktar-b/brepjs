import {
  clone,
  err,
  getSolids,
  isSolid,
  ok,
  validSolid,
  type Result,
  type Solid,
  type ValidSolid,
  type csg,
} from 'brepjs';
import type { ResolvedElement } from 'brepjs-families';
import { specError, type BimError } from './errors/bimError.js';
import { prepareProductBody, type ProductBody } from './types/productBody.js';
import { decomposeFrame, frameInverse, type Frame } from './placementFrame.js';
import { locateShapeInFrame } from './rigidPlacement.js';

export interface CivilProductBodyInput {
  readonly element: ResolvedElement;
  readonly category: 'WALL' | 'RAILING';
  readonly evaluator: csg.Evaluator;
  readonly productWorldFrame: Frame;
}

export interface FamiliesProductBodyTestHooks {
  readonly afterCopy?: ((itemIndex: number, solid: Solid, source: Solid) => void) | undefined;
  readonly beforeLocalize?: ((itemIndex: number, solid: ValidSolid) => void) | undefined;
  readonly afterLocalized?: ((itemIndex: number, solid: ValidSolid) => void) | undefined;
}

let testHooks: FamiliesProductBodyTestHooks | null = null;

/** Package-internal deterministic failure seams for exact ownership tests. */
export function setFamiliesProductBodyTestHooksForTesting(
  hooks: FamiliesProductBodyTestHooks | null
): void {
  testHooks = hooks;
}

/**
 * Clones and localizes every borrowed authored item. The resulting Body is
 * caller-owned until takeProductBody() succeeds, regardless of recipe coincidence.
 */
export function materializeCivilProductBody(
  input: CivilProductBodyInput
): Result<ProductBody, BimError> {
  const evaluated = evaluateBody(input);
  if (!evaluated.ok) return evaluated;
  const sources = evaluated.value;
  if (sources.length === 0) {
    return err(
      productBodyError(input, 'FAMILIES_PRODUCT_BODY_EMPTY', `evaluated to no solid Body items`)
    );
  }

  const localized: ValidSolid[] = [];
  const inverse = decomposeFrame(frameInverse(input.productWorldFrame));
  for (const [itemIndex, source] of sources.entries()) {
    let copied: ReturnType<typeof clone<Solid>>;
    try {
      copied = clone(source);
    } catch (cause) {
      disposeAll(localized);
      return err(
        productBodyError(
          input,
          'FAMILIES_PRODUCT_BODY_COPY_FAILED',
          `Body item ${itemIndex} copy threw`,
          cause,
          itemIndex
        )
      );
    }
    if (!copied.ok) {
      disposeAll(localized);
      return err(
        productBodyError(
          input,
          'FAMILIES_PRODUCT_BODY_COPY_FAILED',
          `Body item ${itemIndex} could not be copied`,
          copied.error,
          itemIndex
        )
      );
    }
    try {
      testHooks?.afterCopy?.(itemIndex, copied.value, source);
    } catch (cause) {
      copied.value[Symbol.dispose]();
      disposeAll(localized);
      return err(
        productBodyError(
          input,
          'FAMILIES_PRODUCT_BODY_COPY_FAILED',
          `Body item ${itemIndex} could not be copied`,
          cause,
          itemIndex
        )
      );
    }
    let valid: ReturnType<typeof validSolid>;
    try {
      valid = validSolid(copied.value);
    } catch (cause) {
      copied.value[Symbol.dispose]();
      disposeAll(localized);
      return err(
        productBodyError(
          input,
          'FAMILIES_PRODUCT_BODY_INVALID',
          `Body item ${itemIndex} could not be validated as a solid`,
          cause,
          itemIndex
        )
      );
    }
    if (!valid.ok) {
      copied.value[Symbol.dispose]();
      disposeAll(localized);
      return err(
        productBodyError(
          input,
          'FAMILIES_PRODUCT_BODY_INVALID',
          `Body item ${itemIndex} is not a valid solid: ${valid.error}`,
          undefined,
          itemIndex
        )
      );
    }

    let local: ValidSolid | null = null;
    try {
      testHooks?.beforeLocalize?.(itemIndex, valid.value);
      local = locateShapeInFrame(valid.value, inverse);
      testHooks?.afterLocalized?.(itemIndex, local);
      localized.push(local);
    } catch (cause) {
      local?.[Symbol.dispose]();
      valid.value[Symbol.dispose]();
      disposeAll(localized);
      return err(
        productBodyError(
          input,
          'FAMILIES_PRODUCT_BODY_LOCALIZE_FAILED',
          `Body item ${itemIndex} could not be moved into the Product-local frame`,
          cause,
          itemIndex
        )
      );
    }
    valid.value[Symbol.dispose]();
  }

  const first = localized[0];
  if (first === undefined)
    return err(
      productBodyError(input, 'FAMILIES_PRODUCT_BODY_EMPTY', 'localized to no solid Body items')
    );
  const prepared = prepareProductBody({
    kind: 'AUTHORITATIVE',
    items: [first, ...localized.slice(1)],
  });
  if (!prepared.ok) disposeAll(localized);
  return prepared;
}

function evaluateBody(input: CivilProductBodyInput): Result<readonly Solid[], BimError> {
  try {
    const evaluated = input.evaluator.evaluate(input.element.geometry);
    if (!evaluated.ok) {
      return err(
        productBodyError(
          input,
          'FAMILIES_PRODUCT_BODY_EVALUATION_FAILED',
          `authored Body evaluation failed: ${evaluated.error.message}`,
          evaluated.error
        )
      );
    }
    return ok(isSolid(evaluated.value) ? [evaluated.value] : getSolids(evaluated.value));
  } catch (cause) {
    return err(
      productBodyError(
        input,
        'FAMILIES_PRODUCT_BODY_EVALUATION_FAILED',
        `authored Body evaluation threw`,
        cause
      )
    );
  }
}

function disposeAll(solids: readonly ValidSolid[]): void {
  for (const solid of solids) solid[Symbol.dispose]();
}

function productBodyError(
  input: CivilProductBodyInput,
  code: string,
  detail: string,
  cause?: unknown,
  itemIndex?: number
): BimError {
  return {
    ...specError(
      code,
      `familiesToBim: '${input.element.keyPath}' (${input.category}) ${detail}`,
      cause
    ),
    metadata: {
      keyPath: input.element.keyPath,
      category: input.category,
      ...(itemIndex !== undefined ? { itemIndex } : {}),
    },
  };
}
