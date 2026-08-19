/**
 * Element model — a pure description tree. Calling a family component builds
 * an Element (no render, no kernel); `render` functions run inside `resolve()`
 * and must stay pure: they return Elements, never touch kernel handles.
 */

import type { ZodType } from 'zod';
import { frame as validateFrame, type Frame } from './frame.js';

export type SemanticKey = string;
export type EngineeringProperty = string | number | boolean;

export interface EngineeringSemantics {
  readonly kind: string;
  readonly role?: string | undefined;
  readonly material?: string | undefined;
  readonly properties?: Readonly<Record<string, EngineeringProperty>> | undefined;
}

export interface Element {
  readonly type: string | DefinitionComponent<never>;
  readonly key: string | undefined;
  readonly frame: Frame | undefined;
  readonly props: Readonly<Record<string, unknown>>;
  readonly children: readonly Element[];
}

interface WithKey {
  readonly key?: SemanticKey | undefined;
  readonly frame?: Frame | undefined;
}

export type DefinitionKind = 'Model' | 'Assembly' | 'Family';

export type ElementChild = Element | readonly ElementChild[] | null | undefined | false;

type ChildrenInvocation<I> = I extends object
  ? 'children' extends keyof I
    ? { readonly children?: ElementChild }
    : { readonly children?: never }
  : never;

export type DefinitionInvocation<I> = I extends object
  ? Omit<I, 'children' | 'key' | 'frame' | 'semantics'> & ChildrenInvocation<I> & WithKey
  : never;

/**
 * A family component: a callable that constructs Elements, carrying its
 * declared name and render function. The component REFERENCE is the identity
 * (copy-in files make name lookup collide); the declared name serves key-path
 * fallbacks and display only.
 *
 * `I` is the INVOCATION props type: with a schema carrying defaults or
 * transforms, callers pass the schema's input while render receives its
 * output `P`. Schema-less families use one type for both.
 */
export interface DefinitionComponent<P, I = P> {
  (props: DefinitionInvocation<I>): Element;
  readonly definitionName: string;
  readonly definitionKind: DefinitionKind;
  /** Compatibility display name retained for existing callers. */
  readonly familyName: string;
  /** `'fill'` marks a family whose instances fill an opening when placed in a
   *  host's `voids` (doors, windows): resolution synthesizes the Opening. */
  readonly role: 'fill' | undefined;
  readonly renderErased: (props: object, children: readonly Element[]) => Element;
  readonly resolveSemanticsErased: (
    props: object,
    children: readonly Element[]
  ) => EngineeringSemantics | undefined;
}

export interface FamilyComponent<P, I = P> extends DefinitionComponent<P, I> {
  readonly definitionKind: 'Family';
}

export interface AssemblyComponent<P, I = P> extends DefinitionComponent<P, I> {
  readonly definitionKind: 'Assembly';
}

export interface ModelComponent<P, I = P> extends DefinitionComponent<P, I> {
  readonly definitionKind: 'Model';
}

export interface DefinitionOptions<P = unknown, I = P> {
  /** Optional Zod schema validated at element construction (the earliest
   *  point with a useful stack). Schema output replaces the props, so
   *  defaults and transforms apply before render — the output type must be
   *  assignable to the render props `P`, enforced by this parameter.
   *  Semantic Keys and rigid Frames are validated separately. */
  readonly props?: ZodType<P, I> | undefined;
  /** Definition-owned engineering meaning. A resolver receives the same
   *  validated typed props as `render`; ordinary props are the only source of
   *  occurrence variation. */
  readonly semantics?: EngineeringSemantics | ((props: P) => EngineeringSemantics) | undefined;
}

export interface FamilyOptions<P = unknown, I = P> extends DefinitionOptions<P, I> {
  readonly role?: 'fill' | undefined;
}

export function normalizeChildren(input: ElementChild): Element[] {
  if (input === null || input === undefined || input === false) return [];
  if (Array.isArray(input)) {
    return (input as readonly ElementChild[]).flatMap((child) => normalizeChildren(child));
  }
  return [input as Element];
}

function validateSemanticKey(key: string | undefined): void {
  if (key === undefined) return;
  if (key.trim().length === 0 || key.includes('/') || key.includes(':')) {
    throw new Error(
      `brepjs-families: semantic key '${key}' must be non-empty and cannot contain '/' or reserved ':'`
    );
  }
}

function validateEngineeringSemantics(
  semantics: EngineeringSemantics | undefined,
  definitionKind: DefinitionKind,
  name: string
): EngineeringSemantics | undefined {
  if (semantics === undefined) return undefined;
  const untyped: unknown = semantics;
  const kind =
    typeof untyped === 'object' && untyped !== null
      ? (untyped as Readonly<Record<string, unknown>>)['kind']
      : undefined;
  if (typeof kind !== 'string' || kind.trim().length === 0) {
    throw new Error(
      `brepjs-families: engineering semantics for ${definitionKind.toLowerCase()} '${name}' requires a non-empty string kind`
    );
  }
  return semantics;
}

function definition<P extends object, I extends object = P>(
  definitionKind: DefinitionKind,
  name: string,
  render: (props: P) => Element,
  options?: FamilyOptions<P, I>
): DefinitionComponent<P, I> {
  const schema = options?.props;
  const semantics = options?.semantics;
  const make = (invocation: DefinitionInvocation<I>): Element => {
    if ((invocation as Readonly<Record<string, unknown>>)['semantics'] !== undefined) {
      throw new Error(
        `brepjs-families: engineering semantics for ${definitionKind.toLowerCase()} '${name}' must be declared on the definition`
      );
    }
    const { key, frame: localFrame, ...inputWithChildren } = invocation;
    validateSemanticKey(key);
    const rawChildren = (inputWithChildren as Readonly<Record<string, unknown>>)['children'];
    const children = normalizeChildren(rawChildren as ElementChild);
    const input = { ...inputWithChildren } as Record<string, unknown>;
    if (rawChildren !== undefined) input['children'] = children;
    let validated: Readonly<Record<string, unknown>> = input;
    if (schema) {
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        throw new Error(
          `brepjs-families: invalid props for ${definitionKind.toLowerCase()} '${name}': ${parsed.error.message}`
        );
      }
      validated = parsed.data as Readonly<Record<string, unknown>>;
    }
    const validatedChildren = normalizeChildren(validated['children'] as ElementChild);
    const props = { ...validated };
    delete props['children'];
    return {
      type: component,
      key,
      frame: localFrame === undefined ? undefined : validateFrame(localFrame),
      props,
      children: validatedChildren.length > 0 ? validatedChildren : children,
    };
  };
  const component: DefinitionComponent<P, I> = Object.assign(make, {
    definitionName: name,
    definitionKind,
    familyName: name,
    role: definitionKind === 'Family' ? options?.role : undefined,
    renderErased: (props: object, children: readonly Element[]) =>
      render({ ...props, children } as P),
    resolveSemanticsErased: (props: object, children: readonly Element[]) => {
      const value =
        typeof semantics === 'function' ? semantics({ ...props, children } as P) : semantics;
      return validateEngineeringSemantics(value, definitionKind, name);
    },
  });
  return component;
}

export function family<P extends object, I extends object = P>(
  name: string,
  render: (props: P) => Element,
  options?: FamilyOptions<P, I>
): FamilyComponent<P, I> {
  return definition('Family', name, render, options) as FamilyComponent<P, I>;
}

export function assembly<P extends object, I extends object = P>(
  name: string,
  render: (props: P) => Element,
  options?: DefinitionOptions<P, I>
): AssemblyComponent<P, I> {
  return definition('Assembly', name, render, options) as AssemblyComponent<P, I>;
}

export function model<P extends object, I extends object = P>(
  name: string,
  render: (props: P) => Element,
  options?: DefinitionOptions<P, I>
): ModelComponent<P, I> {
  return definition('Model', name, render, options) as ModelComponent<P, I>;
}

/** Construct an intrinsic element (`'Box'`, `'Group'`, ...). */
export function el(
  type: string,
  props: Readonly<Record<string, unknown>>,
  children: readonly Element[] = []
): Element {
  const key = props['key'];
  const localFrame = props['frame'];
  if (props['semantics'] !== undefined) {
    throw new Error(
      'brepjs-families: engineering semantics must be declared on a Model, Assembly, or Family definition'
    );
  }
  const rest = { ...props };
  delete rest['key'];
  delete rest['frame'];
  delete rest['semantics'];
  const semanticKey = typeof key === 'string' ? key : undefined;
  validateSemanticKey(semanticKey);
  return {
    type,
    key: semanticKey,
    frame: localFrame === undefined ? undefined : validateFrame(localFrame as Frame),
    props: rest,
    children,
  };
}

export function isFamily(t: Element['type']): t is FamilyComponent<never> {
  return typeof t === 'function' && t.definitionKind === 'Family';
}

export function isDefinition(t: Element['type']): t is DefinitionComponent<never> {
  return typeof t === 'function';
}

export function typeNameOf(e: Element): string {
  return isDefinition(e.type) ? e.type.definitionName : e.type;
}
