# Context map

Read the entries relevant to the task. Shared architecture decisions apply across package contexts.

| Context                              | Read first                                     | Decisions                                 |
| ------------------------------------ | ---------------------------------------------- | ----------------------------------------- |
| Core library and shared architecture | [Architecture](docs/architecture.md)           | [Shared ADRs](docs/decisions/)            |
| BIM domain                           | [BIM glossary](packages/brepjs-bim/CONTEXT.md) | [BIM ADRs](packages/brepjs-bim/docs/adr/) |

For BIM migration work, also read the [migration sequence](packages/brepjs-bim/docs/architecture-migration.md). It distinguishes the current implementation steps from deferred work.

Other packages do not yet have entries for dedicated domain contexts. Consult their existing documentation and source as needed; add glossary and ADR pointers when domain-modeling work establishes them.

[Domain documentation rules](docs/agents/domain.md) explain how to consume and maintain these documents.
