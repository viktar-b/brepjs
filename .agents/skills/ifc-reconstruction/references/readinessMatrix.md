# Readiness matrix

Use this matrix at final review. The linked playbook is authoritative; this page only proves that every learned lesson has a route and an observable check.

| Learned lesson                                           | Authority                                                     | Acceptance evidence                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| Reference IFC is evidence, not product input             | [Intake](intakeAndEvidence.md)                                | Product dependency/source audit; only comparison accepts the IFC path |
| Complete-item decoding and strongest lane                | [Intake](intakeAndEvidence.md)                                | Lane inventory and structured unsupported-item results                |
| Local geometry and scene placement are separate          | [Targets](targetsAndTracer.md)                                | Local target plus independently compared Frames                       |
| Tracer before bulk authoring                             | [Targets](targetsAndTracer.md)                                | One leaf passes author/export/reimport/compare seam                   |
| Typed dimensions, Datum, semantics, clean TSX            | [Leaf](leafFamily.md)                                         | Focused Family test and donor-cleanliness audit                       |
| Calibrated numbers have one engineering owner            | [Set-out](setoutAndDimensions.md)                              | Reconciled number ledger and dimension-propagation tests              |
| Shared placement controls form a reviewable set-out seam | [Set-out](setoutAndDimensions.md)                              | Named controls and resolved Assembly Frame tests                      |
| Repeated Occurrences share one explicit child template   | [Assembly](assemblyAuthoring.md)                               | Exhausted sibling-template audit and resolved-tree tests              |
| Output-preserving refactors prove deterministic identity | [Assembly](assemblyAuthoring.md)                               | Equal byte length, empty `cmp`, and matching cryptographic hashes     |
| One definition/file, explicit occurrences, stable keys   | [Model](modelAndProjection.md)                                | Layout, hierarchy, key, count, and Frame tests                        |
| Declarative Projection is preferred; fallbacks are owned | [Projection](modelAndProjection.md)                           | Public-seam test and complete fallback register                       |
| Authored parametric intent can export as tessellation    | [Projection](modelAndProjection.md)                           | Authored and SPF representation columns reported separately           |
| Geometry does not imply IFC-document equivalence         | [Verification](verificationAndHandoff.md)                     | Independent document profile and constrained classification           |
| CRS, shell, styles, types, schema, and units matter      | [Intake](intakeAndEvidence.md)                                | Source/output document-profile rows                                   |
| Scoped and whole-file coverage differ                    | [Verification](verificationAndHandoff.md)                     | Two explicit denominators                                             |
| Better names/quantities do not offset semantic loss      | [Intake](intakeAndEvidence.md)                                | Row-by-row comparison with no cross-credit                            |
| Inscription string is read from a local crop             | [Leaf](leafFamily.md)                                         | Transcribed string or unidentified-inscription note on the target     |
| Font mismatch after the correct string is a visual exception | [Verification](verificationAndHandoff.md)                  | Visual exception and placement metric reported separately             |
| File size is not fidelity                                | [Intake](intakeAndEvidence.md)                                | No file-size gate or equivalence claim                                |
| Nested civil aggregation is independent                  | [Model](modelAndProjection.md)                                | Typed nested aggregation validation/reimport gate                     |
| Failed gates repair the smallest responsible layer       | [Leaf](leafFamily.md) and [Projection](modelAndProjection.md) | Failure diagnosis and focused rerun                                   |
| Prototype retirement requires forensic parity            | [Handoff](verificationAndHandoff.md)                          | Capability-parity audit; no deletion without authority                |
