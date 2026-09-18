# AuraNav contributor instructions

## Product boundaries

- This is a recreational and informational chart viewer, not a certified ECDIS or a substitute for prudent navigation.
- Keep the S-57 preprocessing pipeline in `pipeline/` and the browser application in `webapp/`.
- Treat the contents of `schema/` as the versioned interface between those two systems.
- Preserve NOAA source attribution, chart edition/update metadata, depth units, and vertical datum information through preprocessing and display.

## Engineering conventions

- Use strict TypeScript for application code.
- Keep browser UI framework-free. MapLibre GL JS is the specialized map renderer; do not introduce React, Vue, Svelte, or a comparable application framework.
- Prefer small modules with explicit inputs and outputs over global mutable state.
- Keep generated charts, downloaded exchange sets, build output, and dependency directories out of version control.
- Make offline behavior and failure states visible to the user.

## Verification

- Run the closest relevant unit tests and type checks for each change.
- For changes spanning both systems, validate the generated package manifest against `schema/tile-metadata.schema.json` and run the webapp build.
- Add focused tests for S-57 update ordering, scale-band selection, GPS permission/error states, and offline behavior when those features are implemented.
- Do not claim navigation-grade correctness from a successful build or visual check.

## Agent coordination

- Delegate independent work when parallel execution saves time or improves review quality.
- Assign file ownership before delegating. Pipeline agents own `pipeline/`; webapp agents own `webapp/`; the primary agent owns root files, `schema/`, and integration.
- Agents must not modify another agent's owned files without first coordinating with the primary agent.
- The primary agent reviews shared contracts and runs integrated checks before marking a milestone complete.

## Planning

- Keep `PLAN.md` current when a milestone, architectural decision, or material risk changes.
- Mark an item complete only after its acceptance criteria have been verified.
