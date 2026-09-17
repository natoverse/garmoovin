# Feature: Garmin Write-Back

> Apply reviewed title changes to Garmin Connect through a separate, authenticated action.

## What

Add an "Apply to Garmin" button alongside "Save JSON". Saving JSON remains a local-only export; applying changes reviews and submits the current draft renames, including activities hidden by filters. An exported JSON file is not required, and importing one remains out of scope.

A localhost backend uses the Python `garminconnect` library to authenticate, read activity details, and update activity names. The page shows connection status and the connected account. Before any writes, show a review of each source activity, verified Garmin activity ID, current Garmin title, and proposed title, then require explicit confirmation.

Report results per activity rather than presenting a partially successful batch as complete. Preserve the imported titles and GPX files; display confirmed Garmin titles and synchronization status separately.

## Acceptance Criteria

- [ ] "Save JSON" never contacts Garmin. "Apply to Garmin" is disabled when disconnected, when no unapplied changes exist, or while a batch is running.
- [ ] Authentication supports first login, MFA when required, saved-session reuse, token refresh, and an actionable reauthentication state. Login or reconnection never automatically starts or resumes writes.
- [ ] The backend derives candidate IDs from the known `garmin-<id>.gpx` filename pattern, then verifies each against activity details accessible to the connected account, including recorded start time and activity type. Missing or contradictory identity evidence, ambiguous source paths, and duplicate target IDs block affected proposals with reasons. Never guess a target from its title or nearest date.
- [ ] Review includes every pending proposal, even hidden rows, identifies blocked entries, and shows the exact eligible count and connected account. Differences between imported and current Garmin titles are prominently flagged for review.
- [ ] Confirmation authorizes only the displayed eligible proposals. The server binds the batch to the account, source identities, verified IDs, reviewed current titles, and proposed titles; subsequent edits cannot alter an approved batch.
- [ ] Immediately before each write, re-read the remote title. If it differs from the reviewed title, mark a conflict and require a new review; if it already equals the proposed title, report "Already applied" without writing. Modify only the activity name.
- [ ] Persist a local operation journal before sending writes, recording account identity, source identity, activity ID, before/after titles, and per-item outcome. If the initial journal cannot be saved, send no writes. Keep it separate from spec 004's export format.
- [ ] Read back each updated title before marking it confirmed. Report confirmed, already applied, blocked/conflict, failed, not attempted, and uncertain outcomes separately. A timeout, interrupted session, or failed verification is not proof of either success or failure.
- [ ] Prevent overlapping submissions. Pause remaining writes on authentication failure or rate limiting, with visible recovery guidance. Before retrying or recovering an interrupted batch, reconcile uncertain items against Garmin and require confirmation for remaining writes; do not blindly replay the batch.
- [ ] Successful items are no longer pending for Garmin; failed and unattempted drafts remain available. Further edits create new pending changes. JSON export, original-title search, filtering, and thumbnails retain their existing behavior.
- [ ] Bind the backend to loopback only, validate the expected Host and Origin, and protect mutation endpoints with a session-bound anti-CSRF token. Reject untrusted origins and unvalidated write requests; localhost alone is not authorization.
- [ ] Credentials and tokens never enter frontend assets, browser storage, JSON exports, or logs. Token storage, journals, and any secret configuration are excluded from Git and deployment artifacts. No GPX archive or route coordinates are uploaded; only required authentication, activity reads, and title updates leave the computer for Garmin.

## Scope

### In scope

- A localhost Python backend, Garmin session handling, and connection/account status.
- Verified activity matching, batch review and confirmation, title-only updates, and read-back verification.
- A local recovery journal, partial-failure reporting, and safe retry behavior.

### Out of scope

- Deployment, multi-user hosting, official partner-API onboarding, and background synchronization.
- Matching activities without verifiable IDs, importing JSON mappings, and automatic conflict resolution.
- Editing activity types or tracks, deletion, and automatic rollback of successful renames.

## Notes

- Extends spec 004's localhost workflow. This explicitly introduces Garmin network access; browsing and JSON export remain usable without authentication.
- Use `cyberjunky/python-garminconnect` (Python package `garminconnect`). Its source provides `get_activity(activity_id)` and `set_activity_name(activity_id, title)`. Pin and verify the selected release during implementation; upstream compatibility is not guaranteed by this spec.
- Authentication is a library-managed session, not an assumed single permanent "Garmin token". Follow the upstream interactive login/MFA flow in a local authentication helper, keeping password entry outside the webpage. The browser only receives connection status and account identity.
- Adopt the upstream example's `GARMINTOKENS` environment variable as a **backend-only token-directory path**, defaulting outside the repository. Use restrictive directory/file permissions, reuse and refresh stored tokens, and prompt again when the session can no longer be restored. Do not require a long-lived password environment variable.
- Research basis: the upstream repository's `README.md` Authentication section, `example.py` session-loading example, and `garminconnect/__init__.py` activity methods. Verify the concrete identity checks and authentication flow with the pinned version before enabling writes.
- Automated coverage must use synthetic fixtures and mocked Garmin responses, including partial failures and uncertain writes. Any real-account rename requires explicit user approval; this specification performs no authentication or write-back.

## Superseding decisions (2026-09-17)

- Garmin write-back is a standalone local writer, not an action or backend of the primary website. The hosted GitHub Pages client has no Garmin authentication, credentials, or Garmin requests.
- The writer accepts only the versioned JSON exported by the website and does not require the original ZIP. Spec 007 evolves that contract to carry the required archive/source identity, Garmin activity ID evidence, recorded start time, activity type, original title, and proposed title.
- Before changing a title, the writer verifies the claimed activity against remote Garmin identity data, presents the verified changes for review, and requires explicit confirmation. It journals the operation before writing, changes only the title, and reads the remote title back before reporting confirmation.
- These decisions replace the in-page “Apply to Garmin,” shared live-draft, and original-archive assumptions above. The remaining authentication, conflict, journaling, partial-failure, and read-back safety requirements still apply to the standalone writer.
