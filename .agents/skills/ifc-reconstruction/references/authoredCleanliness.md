# Authored cleanliness

Run this pass after a tracer export and again before handoff. A reconstruction is an authored model, not a cleaned-up copy of a donor file. Retain only code that has a demonstrated product responsibility or a documented authored-intent obligation.

## Trace effect before deleting

For every suspicious constant, prop, catalog entry, fallback, helper, definition, or metadata field, record an effect ledger row:

| Symbol or field | Validation/definition effect | Resolved tree or semantic effect | Geometry/B-Rep effect | Projection/IFC effect | Authored-intent obligation | Decision and evidence |
| --------------- | ---------------------------- | -------------------------------- | -------------------- | --------------------- | -------------------------- | --------------------- |

The four effect lanes are independent:

1. **Validation and definition:** Does it constrain valid authored input, apply a meaningful default, or define a real variation point?
2. **Resolved tree and semantics:** Does it change hierarchy, Semantic Keys, Frames, Engineering Semantics, relationships, or quantities?
3. **Geometry and B-Rep:** Does it change CSG IR, evaluated shape, placement, topology, or measurable bounds?
4. **Projection and IFC:** Does it change products, spatial structure, relationships, materials, properties, identity, representations, or serialized bytes?

Delete an item only when all four lanes have no effect and no authored-intent obligation remains. Record the search, test, or comparison that proves each relevant absence; names and intuition are not evidence.

## Distinguish residue from intent

Remove:

- unused material, profile, type, style, or classification catalog entries;
- optional props accepted but ignored by render, semantics, children, or Projection;
- donor identity, source labels, inventory fields, and copied defaults with no authored owner;
- redundant aliases, unreachable fallbacks, unused exports/imports, and compatibility branches with no current caller;
- placeholder dimensions and metadata that neither constrain authoring nor survive any downstream lane;
- comments that describe retired donor behavior as if it were still authoritative.

Retain:

- material and relationship declarations that affect IFC even when geometry is identical;
- validation constraints and named dimensions that define a meaningful authoring contract;
- Semantic Keys and Frames that control identity, hierarchy, or placement;
- authored intent required by the reconstruction contract even when the present Projection cannot serialize it.

When authored intent is required but is lost by Projection, record a capability gap. Do not misclassify it as dead code, and do not claim the emitted IFC contains it.

## Audit procedure

1. Freeze the deterministic export inputs and preserve a baseline IFC from the current accepted implementation.
2. Search declarations and call sites for unused exports, ignored destructured fields, constant catalogs, defaulted props, local aliases, special-case branches, and direct Projection adapters.
3. Inspect render and semantics resolvers together. A prop unused by geometry may still own material, quantity, hierarchy, identity, or relationship meaning.
4. Inspect the emitted IFC for corresponding entities, relationships, materials, properties, and identifiers. Absence from geometry alone is insufficient.
5. Remove one coherent residue group. Prefer a truly empty schema over a fake optional prop when a definition has no occurrence parameters.
6. Run focused type, resolved-tree, geometry, Projection, validation, and reimport checks appropriate to the touched lanes.
7. Export again with the same frozen inputs. For an output-preserving cleanup, require equal byte length, an empty byte comparison, and equal cryptographic hashes.
8. Repeat until every retained suspicious item has a witnessed effect or a recorded authored-intent obligation.

If bytes change unexpectedly, inspect the first differing region and determine whether the removed code actually owned Projection-visible meaning or whether export nondeterminism was left uncontrolled. Restore meaning or fix the deterministic harness; never waive the difference.

## Completion gate

The cleanup passes only when:

- the effect ledger has no unexplained retained item;
- no dummy occurrence props or unused catalog entries remain;
- active materials, relationships, Frames, keys, and validation rules have named owners;
- Projection capability gaps are explicit and are not mistaken for serialized fidelity;
- ordinary authored-project tests remain independent of donor data; and
- every output-preserving claim has deterministic byte-for-byte IFC evidence.
