/**
 * React-automatic JSX runtime (`jsxImportSource: "brepjs-families"`). No
 * React: `jsx(type, props, key)` constructs a plain Element; children arrive
 * inside props per the automatic-runtime convention. The plain-function API
 * is primary; JSX is sugar over it.
 */

import {
  el,
  normalizeChildren,
  type DefinitionComponent,
  type Element as FamilyElement,
} from './element.js';

export function jsx<P, I>(
  type: DefinitionComponent<P, I>,
  props: Readonly<Record<string, unknown>>,
  key?: string
): FamilyElement;
export function jsx(
  type: string,
  props: Readonly<Record<string, unknown>>,
  key?: string
): FamilyElement;
export function jsx(
  type: unknown,
  props: Readonly<Record<string, unknown>>,
  key?: string
): FamilyElement {
  if (typeof type === 'function') {
    return (type as unknown as (value: Readonly<Record<string, unknown>>) => FamilyElement)({
      ...props,
      ...(key === undefined ? {} : { key }),
    });
  }
  if (typeof type !== 'string') {
    throw new Error('brepjs-families: JSX element type must be a definition or intrinsic name');
  }
  const rest = { ...props };
  const rawChildren = rest['children'];
  delete rest['children'];
  return el(
    type,
    { ...rest, ...(key === undefined ? {} : { key }) },
    normalizeChildren(rawChildren as never)
  );
}

export const jsxs = jsx;
export const jsxDEV = jsx;

/** Fragment renders nothing itself; its children inline into the parent. */
export const Fragment = 'Fragment';

type IntrinsicGeometryProps = Readonly<Record<string, unknown>> & {
  readonly semantics?: never;
};

// TypeScript's automatic JSX runtime discovers these declarations by namespace.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace JSX {
  export type Element = FamilyElement;
  export interface ElementChildrenAttribute {
    children: unknown;
  }
  export interface IntrinsicAttributes {
    readonly key?: string;
  }
  export interface IntrinsicElements {
    readonly [name: string]: IntrinsicGeometryProps;
  }
}
