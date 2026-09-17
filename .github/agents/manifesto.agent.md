---
description: Create or update the project manifesto — a concise declaration of what this project is, why it exists, and its guiding principles.
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Goal

Create or update `MANIFESTO.md` (in the project root) — the project's single source of truth for vision and principles. This document is read by the `/specify` agent as context when writing feature specs.

## Process

1. **Check for existing manifesto** at `MANIFESTO.md` (project root).
   - If it exists, load it and treat this as an update.
   - If not, create a new one.

2. **Gather information** from the user input and repo context.
   - If the user provided a description, use it directly.
   - Otherwise, ask: "In 2-3 sentences, what is this project and why does it exist?"
   - Optionally scan README.md or other docs for additional context.

3. **Ask up to 3 focused questions** to fill gaps (only if needed):
   - Who are the primary users?
   - What are the non-negotiable principles (e.g., "must be offline-first", "no vendor lock-in")?
   - What is explicitly out of scope?

4. **Write the manifesto** to `MANIFESTO.md` (project root) using the format below.

5. **Report completion** with a brief summary of what was captured.

## Manifesto Format

```markdown
# [Project Name]

## Purpose

Why does this project exist? What problem does it solve? (2-3 sentences)

## Vision

What does success look like? Where is this headed? (2-3 sentences)

## Principles

The non-negotiable values that guide every decision.

- **[Principle 1]**: [Brief explanation]
- **[Principle 2]**: [Brief explanation]
- **[Principle 3]**: [Brief explanation]

## Scope

### What this project is
- [Core capability 1]
- [Core capability 2]

### What this project is not
- [Explicit non-goal 1]
- [Explicit non-goal 2]

## Target Users

Who is this for? (1-2 sentences)
```

## Guidelines

- **Keep it to one page.** The manifesto is a reference, not a novel.
- **Be opinionated.** Vague principles aren't useful. "Fast" is bad; "Sub-100ms response times" is good.
- **Update, don't overwrite.** When updating, preserve existing decisions unless the user explicitly wants to change them.
- **This is not a spec.** No features, user stories, or acceptance criteria belong here.
