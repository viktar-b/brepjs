# Architecture sources

Use these repository decisions as the single source of truth. Read the relevant document before changing a seam; link it from reconstruction specifications and reports rather than copying its rules into another checklist.

| Concern                                                                               | Authoritative source                                                                                   |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Domain boundaries, Frames, Semantic Keys, Reconstruction Targets, capability profiles | [`CONTEXT.md`](../../../../CONTEXT.md)                                                                 |
| Reference evidence isolation                                                          | [ADR-0001](../../../../docs/adr/0001-reference-independent-declarative-models.md)                      |
| Declarative architecture and Projection boundary                                      | [ADR-0002](../../../../docs/adr/0002-use-declarative-composition-for-authored-models.md)               |
| Family/Assembly decomposition                                                         | [ADR-0003](../../../../docs/adr/0003-structure-the-bridge-as-owned-components.md)                      |
| Engineering coordinates, Datums, semantic keys, nested Frames                         | [ADR-0004](../../../../docs/adr/0004-author-bridge-families-in-engineering-coordinates.md)             |
| Typed IFC4X3 Projection and fallback ownership                                        | [ADR-0005](../../../../docs/adr/0005-preserve-authored-structure-through-resolution-and-projection.md) |
| Independent fidelity gates and visual approval                                        | [ADR-0006](../../../../docs/adr/0006-verify-reference-fidelity-with-independent-gates.md)              |
| Reference Harness Interfaces and evidence lanes                                       | [ADR-0007](../../../../docs/adr/0007-use-representation-aware-stepwise-reconstruction.md)              |

## Change rule

Preserve the vocabulary and decisions above. Use domain modeling only when the task genuinely changes normative meaning; then update the domain source and ADR before changing this workflow. Do not turn a reconstruction-specific workaround into architecture by repetition.

The configured Reference Harness package owns source reading, representation adapters, checksums, and comparison evidence. Authored project code owns Families, Assemblies, Models, and ordinary product commands. Projection owns IFC target details. Keep these dependency directions explicit.
