# Domain documentation

This repository uses multiple contexts. Preserve the existing documentation locations.

## Before exploring a domain

Read [the context map](../../CONTEXT-MAP.md), then the glossary and relevant ADRs for each affected context. Read shared architecture decisions when a change crosses package or layer boundaries.

The shared ADR directory is `docs/decisions/`. BIM uses `packages/brepjs-bim/CONTEXT.md` and `packages/brepjs-bim/docs/adr/`. These existing locations remain authoritative.

## Maintaining context

- Use each glossary's vocabulary in specs, tickets, tests, and explanations.
- Check an ADR's status before treating its proposal as accepted or implemented.
- Identify conflicts with existing ADRs explicitly; preserve the decision until a reviewed revision replaces it.
- If a context document does not exist, proceed without creating a placeholder. Domain-modeling work creates documentation when terminology or decisions are resolved.
- For a new package context, use `packages/<package>/CONTEXT.md` and `packages/<package>/docs/adr/`, then add its pointers to the root map.
- Maintain one authoritative glossary or decision record and link to it from other documents.
