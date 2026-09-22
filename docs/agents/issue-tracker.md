# Issue tracker: local Markdown

Specs and issues live under `.scratch/<feature-slug>/`. Tracker operations are local file edits.

## Conventions

- Store the feature spec in `spec.md`.
- Store each implementation ticket in `issues/<NN>-<slug>.md`, numbered from `01`. Use one file per ticket.
- Record triage state in a `Status:` line near the top, using [the label mapping](triage-labels.md).
- Append comments and conversation history under `## Comments`.
- Resolve a ticket reference within its feature directory; use the full path when the feature is ambiguous.
- If a spec already has a canonical repository location, link to it from the tracker instead of duplicating or moving it automatically.

## Skill operations

When a skill says to publish a spec, write the feature's local `spec.md`. When it says to create tickets, write the numbered issue files. Fetching a ticket means reading its file and comments.

Apply `ready-for-agent` by updating the ticket's Status line. Claim work by setting `Status: claimed` before implementation. Complete work by recording its result and setting `Status: resolved`. Claimed and resolved are lifecycle states in addition to the triage vocabulary.

## Dependencies and wayfinding

- Keep a wayfinding map at `.scratch/<effort>/map.md`, with Notes, Decisions-so-far, and Fog sections.
- Put each child in `.scratch/<effort>/issues/<NN>-<slug>.md`. Record its Type as research, prototype, grilling, or task.
- Record dependencies as `Blocked by: NN, NN`, referring to tickets in the same effort.
- A ticket is unblocked when every listed blocker is resolved. Resolve or explicitly revise dependencies before proceeding.
- Select unclaimed, unresolved, unblocked work in ticket-number order, subject to its triage readiness.
- On resolution, append an Answer section, mark the ticket resolved, and add a local evidence link to the map's Decisions-so-far section.

External issue creation, comments, and publication are separate actions requiring authorization in the active task.
