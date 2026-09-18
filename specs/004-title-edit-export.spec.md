# Feature: Title Editing and JSON Export

> Draft activity renames beside the existing titles and save the proposed mappings to a local JSON file.

## What

Add a labeled new-title input beside every activity's existing title. Keep the original title visible and unchanged while the user drafts replacements. Edits belong to individual activities, not names, so two activities with the same name can be renamed independently.

Provide one page-level "Save JSON" button with a pending-change count. It exports all proposed renames from the loaded archive, including activities currently hidden by type filters or search. Saving produces a JSON file through the browser's save/download flow; it does not modify the GPX archive or update Garmin.

For this stage, the app runs on localhost. No deployment, Garmin authentication, or application backend is required for this feature. Garmin write-back will be specified separately.

## Acceptance Criteria

- [x] Every activity has an accessible new-title input beside its read-only existing title. Inputs start empty; empty inputs mean no proposed rename.
- [x] Drafts survive filtering, searching, and thumbnail updates. Search continues to match the existing displayed title, not the draft.
- [x] Leading and trailing whitespace is trimmed on export. Whitespace-only values and titles identical to the original produce no mapping; an empty title can never be exported as a rename.
- [x] A page-level "Save JSON" button shows the total pending-change count and is disabled when there are no effective changes.
- [x] Saving includes every effective rename in the loaded archive exactly once, even for hidden rows. It excludes untouched activities and does not merge activities with identical names.
- [x] The export follows the versioned JSON contract below. Archive identity and full GPX entry paths distinguish source activities without relying on their titles.
- [x] Saving initiates a local JSON save/download and requires no server request. Export failures are visibly reported and preserve drafts; the UI does not claim that Garmin was updated or that a browser download was verified on disk.
- [x] Drafts remain available after export. Repeated saves produce a complete current snapshot, not an incremental patch or duplicate accumulated entries.
- [x] Replacing the archive or leaving the page warns about edits not included in the most recent export, where the browser supports navigation warnings. Drafts from one archive cannot attach to another.
- [x] Source files and existing titles remain unchanged. Exported mappings contain no credentials or route coordinates, stay local, and are Git-ignored if saved inside the repository. Committed examples and fixtures are synthetic.

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
- Implementation keeps drafts by the imported activity's ID, independently of rendered rows and filters. Original titles and route previews remain unchanged.
- Export waits for import completion, computes the selected ZIP's fingerprint on first save, and reuses it until another archive is accepted. A save captures the proposals at click time; subsequent edits remain unexported.
- If any proposal targets a duplicated GPX path, the entire export is blocked rather than silently exporting a partial batch. Duplicate detection includes unreadable GPX entries, not just successful imports.
- The standard filename is `garmin-title-mappings.json`. This filename and browser-numbered copies are ignored and denied by the localhost file server; renamed exports belong in the ignored `local-data/` folder.
- The browser download action is reported as requested, not verified on disk. Each snapshot replaces the in-memory comparison baseline; current drafts are retained. Navigation warnings apply to effective, nonempty proposals that differ from the most recent requested export and depend on browser support.
- Archive replacement is disabled while an export is preparing. An accepted replacement clears drafts, export status, and the fingerprint; cancelling the warning preserves the prior archive and drafts.
- Use `../stronger` as a reference where relevant. No backend, deployment, authentication, or Garmin calls are introduced.

## Inline title refinement decisions (2026-09-17)

- Replace the separate read-only Name and empty New title columns with one prefilled, editable Title field in the main activity details area. Every activity remains editable, including activities whose identity evidence blocks export.
- Keep the field visually close to plain title text: bold text, a transparent background and border at rest, a subtle hover affordance, and a visible keyboard focus ring. Keep elevation/distance statistics below it and retain equal-sized route/elevation previews.
- Preserve imported names internally for identity evidence, original-title search, grouping labels, and JSON `originalTitle`. The editor shows the draft when present without rewriting imported metadata; filtering must not remove a row as its title is being edited.
- Blank values can exist while typing but never export. Leaving a blank/whitespace-only field restores its imported title; Escape discards that activity's draft and restores the imported title, and Enter leaves the editor. Ignore Enter/Escape handling during IME composition. Returning to the exact imported title removes the draft.
- Keep existing trimming, export snapshots, hidden-row proposals, duplicate-name isolation, and navigation/archive-replacement safeguards. These decisions supersede the original two-field presentation, not the schema-v2 export contract established by spec 007.

## Saved-title iteration decisions (2026-09-17)

- Save JSON also remembers the captured, trimmed exported titles in the activity-ID cache specified by spec 009, after requesting the download. Only exported changes persist; unsaved drafts and failed exports do not.
- On the next import, remembered titles are starting titles, not pending edits, and supply JSON `originalTitle` for subsequent renames. Current-session originals, drafts, complete export snapshots, and discard warnings remain unchanged.
- Preserve previews and comparison caches, with no warm GPX parsing. Report failed title persistence separately from the JSON download; clearing during save must not repopulate the cache. Remembering a title does not confirm a disk save or a Garmin update.

## Activity type editing decisions (2026-09-18)

- Extend the existing per-activity editing flow with an accessible Type selector, including Running and Trail Running even if the archive contains no trail runs. Offer common categories and known categories present in the archive; the local writer verifies the chosen category against Garmin's catalog.
- Keep title and type drafts independent, attached to row identity, and editable in both ordinary and grouped lists. Show the starting type when changed; selecting it again removes the type proposal. Filtering continues to use starting types so recategorizing a row does not hide it mid-edit.
- Count changed activities, not changed fields. Export type-only, title-only, and combined proposals, including hidden rows, with the same identity checks, snapshot semantics, and discard warnings. Preserve original metadata and GPX files.
- Title-only exports retain schema 2. Any export containing a type change uses schema 3 as defined in spec 007; an omitted field means leave that remote field unchanged.
- Save JSON remembers only exported title/type fields in complete cached records for the next import, as specified in spec 009. No bulk recategorization, Garmin browser requests, or automatic write-back is introduced.
- Populate each native selector's full option list on pointer/keyboard focus; inactive selectors retain only their starting and selected values. This avoids thousands of unnecessary option elements when regrouping large archives.

## Inline type refinement decisions (2026-09-18)

- Unify the read-only type badge and separate selector into one tag-styled native dropdown, prefilled with the starting type and showing the draft after selection. Like the inline title editor, it displays only the current value, with hover and keyboard-focus affordances.
- Keep the starting type as an option, without a "Keep" prefix; choosing it removes only the type draft. Escape with the native menu closed restores the starting type and leaves the editor. Preserve native pointer and keyboard selection, including Enter to confirm a menu choice.
- Preserve unknown, numeric, and unrecognized starting labels even when they are not offered as new categories. Bound the single-line selector to 180 pixels; long labels remain available in the native menu and full-value tooltip rather than wrapping a separate badge.
- Retain lazy option population, independent title/type drafts, grouped-list editing, original-type filtering, export validation, cache persistence, and discard safeguards. These decisions supersede the separate starting-type badge presentation above.

## Bulk editing decisions (2026-09-18)

- Every activity has an accessible checkbox in ordinary and grouped lists. Selection uses imported row IDs, not titles or Garmin IDs, so duplicate names and unexportable activities remain independently selectable.
- A selection header above the list offers Select all and Select none with a selected count. Select all adds currently shown activities; Select none clears the entire selection without clearing drafts. Selections survive filters, search, and regrouping, with hidden selections counted explicitly. Newly imported rows are not automatically selected; accepting another archive resets selection.
- With two or more selected activities, show a shared title editor and type dropdown. Display common current values or mixed-value placeholders; merely selecting rows or focusing controls never changes drafts. Each field change immediately updates that field for every selected activity, including hidden selections, without changing the other field or any unselected activity.
- Reuse existing title/type drafts and type options. Empty bulk titles restore each selected activity's starting title on blur; Escape restores the selected field's starting values, and Enter finishes title editing. Ignore composition keystrokes. Returning a field to a row's starting value removes only that row's corresponding draft.
- Preserve per-row overrides, original-title/type filtering, lazy row type options, export schemas and validation, complete snapshots, Save JSON cache persistence, and discard safeguards. Selecting/deselecting alone creates no proposal. Bulk operations do not modify GPX files or contact Garmin; these decisions supersede the earlier exclusion of bulk recategorization.
