# Feature: Title Editing and JSON Export

> Draft activity renames beside the existing titles and save the proposed mappings to a local JSON file.

## What

Add a labeled new-title input beside every activity's existing title. Keep the original title visible and unchanged while the user drafts replacements. Edits belong to individual activities, not names, so two activities with the same name can be renamed independently.

Provide one page-level "Save JSON" button with a pending-change count. It exports all proposed renames from the loaded archive, including activities currently hidden by type filters or search. Saving produces a JSON file through the browser's save/download flow; it does not modify the GPX archive or update Garmin.

For this stage, the app runs on localhost. No deployment, Garmin authentication, or application backend is required for this feature. Garmin write-back will be specified separately.

## Acceptance Criteria

- [ ] Every activity has an accessible new-title input beside its read-only existing title. Inputs start empty; empty inputs mean no proposed rename.
- [ ] Drafts survive filtering, searching, and thumbnail updates. Search continues to match the existing displayed title, not the draft.
- [ ] Leading and trailing whitespace is trimmed on export. Whitespace-only values and titles identical to the original produce no mapping; an empty title can never be exported as a rename.
- [ ] A page-level "Save JSON" button shows the total pending-change count and is disabled when there are no effective changes.
- [ ] Saving includes every effective rename in the loaded archive exactly once, even for hidden rows. It excludes untouched activities and does not merge activities with identical names.
- [ ] The export follows the versioned JSON contract below. Archive identity and full GPX entry paths distinguish source activities without relying on their titles.
- [ ] Saving initiates a local JSON save/download and requires no server request. Export failures are visibly reported and preserve drafts; the UI does not claim that Garmin was updated or that a browser download was verified on disk.
- [ ] Drafts remain available after export. Repeated saves produce a complete current snapshot, not an incremental patch or duplicate accumulated entries.
- [ ] Replacing the archive or leaving the page warns about edits not included in the most recent export, where the browser supports navigation warnings. Drafts from one archive cannot attach to another.
- [ ] Source files and existing titles remain unchanged. Exported mappings contain no credentials or route coordinates, stay local, and are Git-ignored if saved inside the repository. Committed examples and fixtures are synthetic.

## Scope

### In scope

- Per-activity title drafts, a pending-change count, and one JSON export action.
- Stable source identification, basic title normalization, and unsaved-edit safeguards.
- Localhost use and browser-managed file saving.

### Out of scope

- Garmin API calls, remote activity matching, write-back, tokens, and authentication.
- A backend, deployment, automatic overwriting of a fixed disk path, or editing GPX files.
- Bulk title transformations, importing saved mappings, and cross-session draft persistence.

## Notes

- Extends specs 001-003. A saved mapping is a proposal, not evidence of a successful Garmin rename.
- Export contract: `schemaVersion` is `1`; `archiveFingerprint` is the SHA-256 digest of the selected ZIP; `changes` is an array of objects containing `sourceFile` (full GPX entry path), `originalTitle`, and `newTitle` (all strings).
- Duplicate GPX entry paths within an archive are ambiguous and must block export for affected activities with a visible explanation rather than produce indistinguishable mappings.
- A later Garmin spec must verify remote activity identity and define credential handling before applying these proposals. Neither a filename nor an exported original title alone proves a remote match.
- Use `../stronger` as a reference where relevant. This spec defines the next feature; it does not implement it.
