# Keep authored models independent of reference artifacts

An authored brepjs model is a declarative composition of engineering Families, Occurrences, and Assemblies; a Reference IFC may calibrate and verify that model but never supplies runtime geometry, placement, identity, or inventory data. Families use engineering vocabulary and local frames, while target-specific IFC semantics belong to Projection. This favors readable, editable parametric intent over vertex-exact reproduction and prevents reverse-engineering machinery from becoming the authoring interface.

## Considered options

- Import the Reference IFC or an extracted inventory at runtime: rejected because it makes the reference, rather than authored source, the model.
- Preserve source transforms, Express IDs, and GlobalIds in family props: rejected because imported identity and opaque placement are not meaningful authoring concepts.
- Put IFC writer calls inside families: rejected because it couples reusable engineering definitions to one projection target.

## Consequences

Reference comparison lives in a separate Reference Harness; semantic keys replace imported identifiers; nested local frames replace baked world transforms; and exact tessellation is used only for irreducible decorative assets rather than structural components.
