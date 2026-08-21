# Assembly authoring

Use this workflow for every new Assembly and every Assembly cleanliness repair. Preserve explicit engineering hierarchy while giving repeated meaning one source of truth.

## 1. Write the child contract

List every intended child Occurrence with its Semantic Key, definition, parent-relative control, intentional variation, and shared configuration. Separate dimensions, set-out, and Engineering Semantics using the [ownership pass](setoutAndDimensions.md).

Completion: the list accounts for every intended child exactly once, and another engineer can review the hierarchy without evaluating geometry.

## 2. Run the sibling-template audit

Group siblings by child definition and compare their props.

- Keep one-off or heterogeneous major Occurrences as direct keyed TSX children.
- For two or more occurrences of one definition, write an explicit descriptor table containing only varying intent: stable key, named set-out/control, and genuine per-occurrence variation.
- Render the group through one JSX template whose named shared-props object owns every common dimension, material, semantic name, and option.
- For a mathematical pattern, derive descriptors from named count and pitch while still producing deterministic Semantic Keys.

Prefer a local descriptor table over a generic factory. The table keeps the physical inventory visible; the template removes the divergence surface. Source-derived identities, anonymous positional tuples, and array-index keys do not express authored occurrence intent.

Completion: every repeated child definition has one JSX template and one reviewable descriptor source, or a recorded engineering reason why its occurrences do not share a contract.

## 3. Author the Assembly

Validate typed Assembly props. Derive shared child props once, then map descriptors in the intended authored order. Build each Local Frame from named set-out controls and attach the descriptor's stable key. Keep child-specific variation in the descriptor rather than conditional branches inside the template.

After authoring, search the file for repeated child tags and repeated prop blocks. Reconcile every match against the sibling-template audit; extracting syntax that does not represent shared meaning is unnecessary.

Completion: the TSX shows the Assembly boundary, the occurrence inventory, and the shared definition contract without copy-pasted child configuration.

## 4. Verify structure and output

Resolve the actual Assembly and test:

- ordered Semantic Key paths and occurrence counts;
- child definitions, Engineering Semantics, and shared props;
- every descriptor's Local Frame and intentional variation;
- prop changes propagating through all occurrences sharing the template.

For a cleanup claimed to preserve output, capture the pre-change export before editing. Freeze timestamps and any other declared exporter nondeterminism, generate pre-change and post-change IFC with identical dependencies and configuration, then compare byte length, `cmp`, and a cryptographic hash. If bytes differ, report the first difference and classify it before accepting the refactor. For an intentional model change, run independent Fidelity Gates instead of claiming byte identity.

Completion: focused tests pass, the sibling-template audit is exhausted, and the evidence supports either exact byte preservation or an explicitly measured model change.
