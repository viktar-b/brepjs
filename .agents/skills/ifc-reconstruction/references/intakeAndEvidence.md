# Intake and evidence

## 1. Configure the effort

Record these paths without assuming a layout:

```yaml
authored_project_root: <product package>
reference_harness_root: <evidence package>
reference_manifest_path: <checksummed manifest>
reference_ifc_path: <input accepted only by comparison commands>
evidence_root: <ignored or reference-owned generated evidence>
output_ifc_path: <authored export>
report_path: <final reconstruction report>
```

Also record authority, desired scope, expected outputs, threshold source, and whether an existing prototype is evidence to retire. A prototype is never an authored dependency.

## 2. Write two profiles

The **Reconstruction Capability Profile** states required geometry, representation evidence, hierarchy, semantics, relationships, placement, identity, repetition, outputs, and numerical/visual gates. For each requirement record `required`, `supported`, `fallback`, or `missing`, plus the owning layer.

The independent **IFC Document Fidelity/Capability Profile** inventories source and intended output for:

- schema and version;
- physical length units;
- the full spatial shell and every `CompositionType`;
- projected CRS and map conversion;
- object styles and surface colours;
- named type objects and per-product type coverage;
- property-set and base-quantity coverage;
- typed `UsageType` and other applicable civil attributes;
- source-preserved versus deterministic generated `GlobalId` policy;
- source versus output representation kind: tessellated, swept, extruded, or analytic;
- every placed non-spatial source object.

Do not trade across rows. Cleaner names, quantities, or UsageType in the reconstruction do not compensate for missing source document semantics. File-size differences are not a fidelity metric.

## 3. Inventory through the public Interface

Use only the configured Reference Harness public Interface. If it cannot expose required evidence, record a harness capability gap instead of bypassing it with ad hoc IFC parsing.

Inventory:

- schema, units, project/site/facility/part hierarchy, aggregation, containment, and placements;
- names, materials, types/styles, properties, quantities, civil attributes, CRS/map conversion, and identity evidence;
- entity counts, complete representation item types, bounds, elevations, closedness, and volumes where meaningful;
- repeated components, including mapped or shared representation evidence;
- all placed non-spatial objects, not only the intended product scope.

Report two denominators: scoped products and all placed non-spatial objects. One hundred percent scoped coverage can coexist with incomplete whole-file coverage.

## 4. Create the Reference Manifest

Store the manifest and raw source identity only inside the Reference Harness boundary. Include:

- checksum of the Reference IFC;
- stable authored Semantic Key path to harness-owned source selector mapping;
- expected evidence lane and scope classification;
- repetition grouping where applicable;
- explicit excluded/unmapped evidence.

Authored Semantic Keys are product identity. Source GlobalIds or Express IDs are selection evidence only and must not enter authored/runtime source.

## 5. Preserve representation meaning

Dispatch on the complete representation item, never a child coordinate/profile entity:

- tessellated evidence preserves indexed topology, orientation, closedness, and physical units;
- parametric evidence preserves exact dimensions, profile/solid placement, extrusion/sweep direction, and analytic observations;
- analytic B-Rep evidence preserves surfaces, curves, parameters, topology, adjacency, orientation, and closedness.

Choose the strongest supported lane per item. Do not flatten analytic or parametric meaning just because a comparison mesh is also useful. Return source-neutral evidence and structured errors; source adapter types remain private.

## Exit criteria

- Both profiles are reviewable and checksummed evidence is reproducible.
- Scoped and whole-file inventories reconcile independently.
- Unsupported representations, document features, and fallbacks identify an owning layer and do not disappear from later reporting.
