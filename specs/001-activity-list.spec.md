# Feature: Activity List

> Browse the activities in a locally selected Garmin GPX ZIP by name, type, and date.

## What

Create a basic web app where the user selects a Garmin GPX ZIP from their computer and sees a read-only table of all activities in that archive. Each row represents one GPX file and shows its activity name, activity type, and recorded date, ordered newest first.

The archive is read in the browser, not uploaded or bundled with the app. Show loading progress, the number of activities loaded, and any files that could not be read. Selecting another archive replaces the current list.

This is the first step toward the route-first gallery described in `MANIFESTO.md`; route images are deliberately deferred.

## Acceptance Criteria

- [x] The user can select a local ZIP and view every readable GPX activity within it, including GPX files in nested folders. Non-GPX entries are ignored.
- [x] The table has labeled Name, Type, and Date columns and displays the loaded activity count.
- [x] Name uses the GPX track name, then the metadata name, then the filename when neither is available.
- [x] Type uses the exported activity type, with readable formatting. Missing types display "Unknown"; unrecognized values remain visible rather than being guessed.
- [x] Date uses the earliest valid trackpoint timestamp, falling back to the GPX metadata timestamp. Dates are displayed in UTC with that convention labeled; missing or invalid dates display "Unknown". ZIP and filesystem timestamps are never used as activity dates.
- [x] Activities sort newest first, with unknown dates last and filename as a stable tie-breaker. Activities with identical names remain separate rows.
- [x] Before selection, the app explains how to open an archive. Loading is visibly indicated; an empty archive and an unreadable ZIP produce distinct, actionable messages.
- [x] A malformed GPX does not prevent other activities from loading. Skipped files are identified with reasons and a count; missing name, type, or date alone does not discard an activity.
- [x] Selecting a replacement archive clears the prior results and errors. Opening an archive requires no Garmin login and sends no file contents or activity metadata to a server.
- [x] The source ZIP remains unchanged and ignored by Git. Neither it nor extracted activities or generated activity data enters commits or deployment artifacts; committed test fixtures are synthetic.

## Scope

### In scope

- Basic web app shell, local ZIP selection, and a read-only activity table.
- Metadata extraction, default date ordering, and loading, empty, and error states.

### Out of scope

- Route snapshots, maps, filtering, search, and geographic or shape-based grouping.
- Renaming, Garmin Connect integration, account authentication, and write-back.
- Saved imports, cross-session persistence, and non-GPX activity formats.

## Notes

- Use `../stronger` as a reference for relevant app conventions, not as a requirement to copy its architecture.
- The supplied local archive contains GPX exports; sampled files have one track with a name, textual type, metadata timestamp, and trackpoint timestamps. These fields must still be treated as optional.
- "All activities" means all readable GPX activities in the selected archive, not the complete Garmin account history.
- Implementation uses TypeScript, React, and Vite, following Stronger's frontend conventions without Firebase or deployment configuration.
- ZIP entries are read sequentially with `@zip.js/zip.js`, including checksum validation per GPX file. Browser XML parsing supports GPX 1.0, GPX 1.1, and unnamespaced exports; foreign extension fields do not override activity metadata.
- Only timestamps with an explicit timezone and valid calendar fields are accepted. GPX 1.0 root-level name/time fields serve as the legacy metadata fallback.
- Imports progressively populate the list. Replacing an archive cancels the previous import and prevents stale results from appearing.
- Generated activity data belongs in the ignored `local-data/` directory. The app does not persist imports or copy archives into build assets.
