/**
 * brepjs-families — declarative family layer over the brepjs CSG IR.
 *
 * Element trees are identity-preserving (key paths, attributes,
 * relationships); projection onto the content-addressed IR is where
 * deduplication happens for free. Domain-neutral: no BIM imports here.
 */

export {
  family,
  assembly,
  model,
  el,
  normalizeChildren,
  type Element,
  type ElementChild,
  type DefinitionKind,
  type DefinitionComponent,
  type FamilyComponent,
  type AssemblyComponent,
  type ModelComponent,
  type DefinitionInvocation,
  type SemanticKey,
  type DefinitionOptions,
  type FamilyOptions,
} from './element.js';
export {
  civilSemantics,
  type EngineeringProperty,
  type EngineeringSemantics,
  type CustomEngineeringSemantics,
  type CivilEngineeringSemantics,
  type SiteEngineeringSemantics,
  type FacilityEngineeringSemantics,
  type SpatialPartEngineeringSemantics,
  type ProductEngineeringSemantics,
  type SpatialComposition,
  type SpatialSubdivision,
} from './engineeringSemantics.js';
export { frame, type Frame, type FrameVector } from './frame.js';
export { jsx, jsxs, Fragment } from './jsxRuntime.js';
export {
  resolve,
  tTranslate,
  type TransformOp,
  type Relationship,
  type ResolvedElement,
} from './resolve.js';
export {
  evaluateModel,
  type EvaluatedModel,
  type EvaluatedNode,
  type EvaluateModelOptions,
} from './evaluateModel.js';
