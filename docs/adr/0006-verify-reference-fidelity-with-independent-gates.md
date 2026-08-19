# Verify reference fidelity with independent gates

The authored bridge and its Reference Harness have separate dependency graphs and commands. The harness alone owns a Reference Manifest that maps authored Semantic Keys to GlobalIds in a checksummed Reference IFC. The raw IFC is supplied by configurable path unless redistribution is explicitly permitted. Generated IFC, meshes, screenshots, and reports stay ignored; only deliberately approved compact baselines are committed.

Completion is assessed through independent Fidelity Gates rather than a composite score. The finished model contains exactly three Bridges, eighteen BridgeParts, and forty-seven scoped products. Every product has the intended semantic key, IFC class, containment, and material; generated GlobalIds are deterministic without copying source GlobalIds. Simple dimensions must be within 2 mm, authored control-point placements within 5 mm, whole-bridge envelope faces within 10 mm, and comparable recorded volumes within 2%. For curved profiles, 95% of sampled surface lies within 25 mm of the reference and no sample exceeds 75 mm. IFC validation and reimport must pass, followed by separate visual approval.

Visible bridge-sign lettering is authored using the text-to-BRep API and a declared project font. An unidentified exact reference font is recorded as a narrow visual exception rather than recovered from source tessellation. Direct named imports, PascalCase definition names, kebab-case Semantic Keys, short Datum contracts, and small typed props interfaces form the project navigation convention. A boundary test rejects imports from the Reference Harness and rejects reconstruction artifacts such as imported identifiers, absolute source paths, raw matrices, inventory files, and reference-derived vertex arrays.

## Considered options

- Put reference mappings or source identities in the Model for convenient comparison: rejected because verification data would become production authoring input.
- Commit all generated comparison artifacts: rejected because noisy outputs obscure the owned source and become stale easily.
- Preserve exact reference GlobalIds: rejected because authored Semantic Keys, not imported identity, are the durable source of generated identity.
- Report a weighted fidelity percentage: rejected because strong geometry can conceal broken hierarchy, semantics, or relationships.
- Omit or reuse tessellated source lettering: rejected because the sign would either be visibly incomplete or cease to be hand-authored.

## Consequences

Normal project commands are `npm run check`, `npm run preview`, and `npm run export:ifc`; none requires the Reference IFC. `npm run reference:compare -- --ifc <path>` enters the separate harness. Delivery proceeds through five gates: declarative runtime, BIM infrastructure, a passing road-bridge vertical slice, remaining clean definitions, and full forty-seven-product comparison. The vertical slice contains the root Model, RoadGirderBridge, deck and pier BridgeParts, BridgeDeck, MainGirder, and a RoadPier composed of CrossGirder, PierStem, and Footing. Full component authoring does not begin until that slice previews, resolves Frames, exports typed IFC, reimports, and passes its applicable reference comparisons.
