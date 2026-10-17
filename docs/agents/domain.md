# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout decision (confirmed at setup)

**single-context** — this repo shares one root-level domain/glossary file (`CONTEXT.md` at the repo root; the skill templates refer to this file as `GLOSSARY.md` — same file, one location) and durable architecture decisions live in `docs/adr/`. No `CONTEXT-MAP.md` / `GLOSSARY-MAP.md` and no per-subproject glossary files; not created at setup — the first file is written lazily when the first term actually gets resolved (via `/domain-modeling`).

## Before exploring, read these

- **`CONTEXT.md`** at the repo root (the single-context glossary; skill templates name it `GLOSSARY.md`)
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo (this repo):

```
/
├── CONTEXT.md            (root glossary, created lazily)
├── docs/adr/
│   ├── 0001-example-decision.md
│   └── 0002-another-decision.md
└── src/ (apps/packages...)
```

Multi-context layout (`CONTEXT-MAP.md` / `GLOSSARY-MAP.md` pointing at per-context files) is **not** used here. If the repo ever genuinely splits into contexts, re-run setup or edit this file.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the root glossary. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
