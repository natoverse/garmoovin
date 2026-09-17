---
description: Create a lightweight feature spec that maps to a single well-scoped PR.
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Context

Read `MANIFESTO.md` (in the project root) to understand the project's purpose and principles. Use it as context when writing the spec — the feature should align with the manifesto's vision.

## Goal

Create a small, focused feature specification. Each spec maps to **one PR**. Keep it lightweight — avoid over-specification.

## Process

1. **Parse the feature description** from the user input above.
   - If empty, ask the user: "What feature would you like to specify?"

2. **Ask up to 3 clarifying questions** (only if genuinely needed).
   - Skip clarification if the feature description is clear enough.
   - Focus on scope boundaries: what's in vs. out for this PR.

3. **Determine the spec number**.
   - List existing files under `specs/` matching the pattern `NNN-*.spec.md`.
   - Find the highest number and increment by 1.
   - If none exist, start at `001`.
   - Generate a short kebab-case slug from the feature description (2-4 words).
   - The file name is `NNN-slug.spec.md` (e.g., `001-user-auth.spec.md`).

4. **Write the spec** to `specs/NNN-slug.spec.md` using the format below.

5. **Commit and push** the new spec file immediately:
   - `git add specs/NNN-slug.spec.md`
   - Commit with message: `docs: add spec NNN — [Short title]`
   - Push to `main` (pull with rebase first if needed to avoid conflicts).
   - This ensures the spec-to-issue workflow creates a tracking issue automatically.

6. **Report completion** with the spec file path, commit, and a one-line summary.

## Spec Format

```markdown
# Feature: [Short title]

> One-sentence summary of what this feature does and why it matters.

## What

Describe the feature in plain language. Focus on what the user experiences or what changes in the system. 2-4 paragraphs max.

## Acceptance Criteria

A checklist of concrete, testable conditions that define "done" for this PR.

- [ ] [Criterion 1]
- [ ] [Criterion 2]
- [ ] [Criterion 3]

## Scope

### In scope
- [What this PR includes]

### Out of scope
- [What is explicitly deferred to future specs]

## Notes

Any assumptions, open questions, or context that would help the implementer.
```

## Guidelines

- **Keep it short.** A good spec fits on one screen with no scrolling. If it doesn't, the scope is too broad — split it.
- **Focus on WHAT, not HOW.** No implementation details, tech choices, or code structure.
- **One PR = one spec.** If the feature feels too big, suggest splitting it into multiple specs.
- **Be concrete.** Acceptance criteria should be unambiguous and testable.
- **Align with the manifesto.** Reference the project's purpose when it adds clarity.
- **Act as a thoughtful engineer.** Treat the spec process as a Q&A to ensure the problem is well understood and documented. If the user's request is ambiguous, ask clarifying questions before writing. If you see risks, gaps, or blocking technical decisions, call them out.
- **Give feedback.** After writing the spec, note any concerns: scope that should be narrowed, features that should be split into separate specs, open questions that need answers before implementation, or trade-offs the user should be aware of.
