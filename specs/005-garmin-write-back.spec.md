# Feature: Garmin Write-Back

> Apply reviewed title changes to Garmin Connect through a separate, authenticated action.

## What

Provide a standalone Python CLI that accepts the self-contained, versioned JSON edit configuration downloaded by the static website. It requires neither the original ZIP nor a connection to the website. Saving JSON and all browser interactions remain local-only, with no Garmin authentication or write-back controls.

The CLI uses `garminconnect` to authenticate, read activity details, and update activity names. Before any writes, show the connected account and a review of each source activity, verified Garmin activity ID, current Garmin title, and proposed title, then require explicit terminal confirmation.

Report results per activity rather than presenting a partially successful batch as complete. Preserve the input JSON and GPX files. Results belong to terminal output and a private local journal, not live browser state.

## Acceptance Criteria

- [x] The website never contacts Garmin. The CLI validates schema-v2 JSON without requiring the ZIP; review/login never send writes, and apply requires explicit interactive confirmation.
- [x] Authentication supports first login, MFA when required, saved-session reuse, token refresh, and an actionable reauthentication state. Login or reconnection never automatically starts or resumes writes.
- [x] The CLI checks exported candidate IDs against the known `garmin-<id>.gpx` filename pattern, then verifies exact owned-account membership and remote identity, including recorded start time and activity type. Invalid input or missing/ambiguous identity fails validation; remote contradictions block affected proposals with reasons. Never guess a target from its title or nearest date.
- [x] Review includes every exported proposal, including those drafted on hidden rows, identifies blocked entries, and shows the exact eligible count and connected account. Differences between imported and current Garmin titles are prominently flagged for review.
- [x] Confirmation authorizes only the displayed eligible proposals. The CLI binds the in-memory batch to the account, source identities, verified IDs, reviewed current titles, and proposed titles; subsequent input-file edits cannot alter an approved batch.
- [x] Immediately before each write, re-read the remote title. If it differs from the reviewed title, mark a conflict and require a new review; if it already equals the proposed title, report "Already applied" without writing. Modify only the activity name.
- [x] Persist a local operation journal before sending writes, recording account identity, source identity, activity ID, before/after titles, and per-item outcome. If the initial journal cannot be saved, send no writes. Keep it separate from spec 004's export format.
- [x] Read back each updated title before marking it confirmed. Report confirmed, already applied, blocked/conflict, failed, not attempted, and uncertain outcomes separately. A timeout, interrupted session, or failed verification is not proof of either success or failure.
- [x] Prevent overlapping submissions. Pause remaining writes on authentication failure or rate limiting, with visible recovery guidance. Before retrying or recovering an interrupted batch, reconcile uncertain items against Garmin and require confirmation for remaining writes; do not blindly replay the batch.
- [x] Repeated/recovered batches skip already-applied titles after verifying remote state. Failed and unattempted proposals remain in the unchanged JSON and journal. Browser drafts, search, filters, grouping, and thumbnails remain independent.
- [x] No HTTP server, localhost bridge, listener, or browser authentication session is introduced. Reject invalid JSON before connecting and prevent simultaneous writers sharing private token/journal storage.
- [x] Credentials and tokens never enter frontend assets, browser storage, JSON exports, or logs. Token storage, journals, and any secret configuration are excluded from Git and deployment artifacts. No GPX archive or route coordinates are uploaded; only required authentication, activity reads, and title updates leave the computer for Garmin.

## Scope

### In scope

- A standalone Python CLI, terminal-only authentication, saved-session reuse, and account display.
- Verified activity matching, batch review and confirmation, title-only updates, and read-back verification.
- A local recovery journal, partial-failure reporting, and safe retry behavior.

### Out of scope

- Deployment, multi-user hosting, official partner-API onboarding, and background synchronization.
- Matching activities without verifiable IDs, reading ZIP archives in the writer, and automatic conflict resolution.
- Editing activity types or tracks, deletion, and automatic rollback of successful renames.

## Notes

- Consumes spec 007's schema-v2 handoff, superseding spec 004's insufficient version-1 format. Garmin network access exists only in the explicitly invoked CLI.
- Use `cyberjunky/python-garminconnect` (Python package `garminconnect`). Its source provides `get_activity(activity_id)` and `set_activity_name(activity_id, title)`. Pin and verify the selected release during implementation; upstream compatibility is not guaranteed by this spec.
- Authentication is a library-managed session, not an assumed single permanent "Garmin token". Follow the upstream interactive login/MFA flow in the CLI. The browser receives no connection status, account identity, credentials, or results.
- Adopt the upstream example's `GARMINTOKENS` environment variable as a **CLI-only token-directory path**, defaulting outside the repository. Use restrictive directory/file permissions, reuse and refresh stored tokens, and prompt again when the session can no longer be restored. Do not require a long-lived password environment variable.
- Research basis: the upstream repository's `README.md` Authentication section, `example.py` session-loading example, and `garminconnect/__init__.py` activity methods. Verify the concrete identity checks and authentication flow with the pinned version before enabling writes.
- Automated coverage must use synthetic fixtures and mocked Garmin responses, including partial failures and uncertain writes. Any real-account rename requires explicit user approval; this specification performs no authentication or write-back.

## Superseding decisions (2026-09-17)

- Garmin write-back is a standalone local writer, not an action or backend of the primary website. The hosted GitHub Pages client has no Garmin authentication, credentials, or Garmin requests.
- The writer accepts only the versioned JSON exported by the website and does not require the original ZIP. Spec 007 evolves that contract to carry the required archive/source identity, Garmin activity ID evidence, recorded start time, activity type, original title, and proposed title.
- Before changing a title, the writer verifies the claimed activity against remote Garmin identity data, presents the verified changes for review, and requires explicit confirmation. It journals the operation before writing, changes only the title, and reads the remote title back before reporting confirmation.
- These decisions replaced the original in-page “Apply to Garmin,” shared live-draft, and original-archive assumptions. The remaining authentication, conflict, journaling, partial-failure, and read-back safety requirements still apply to the standalone writer.

## Implementation decisions

- Entry point: `python -m garmin_writer`, with `login`, `review <JSON>`, `apply <JSON>`, `reconcile`, and `reconcile --apply`. No FastAPI/Uvicorn, HTTP API, browser Garmin panel, or proxy remains.
- `review` and `reconcile` are read-only. Applying always displays a fresh immutable review and requires typing `APPLY` in an interactive terminal; no unattended confirmation option exists.
- Schema version 2 is documented in README and spec 007. Reject version 1, unknown/duplicate fields, invalid/missing identity, duplicate targets, and inputs over 1 MiB before authenticating. JSON provides all source evidence; the ZIP fingerprint is provenance, not authorization.
- Own-account ID membership uses a three-day date listing around the source UTC day, followed by exact ID, type, and a maximum 60-second time difference. Both root and summary-DTO metadata layouts are supported.
- Store refreshed tokens under `~/.groomin/tokens` by default and journals under `~/.groomin/journal` (`GROOMIN_JOURNAL_DIR` override). Require owner-only, dedicated storage outside the repository; hold token and journal process locks for the invocation.
- Journal before the batch and before each possible mutation. Require read-back; pause on rate limiting, authentication failure, or uncertainty. Restart recovery re-reads remote state and never automatically replays writes.
- Both units retain independent state. The writer does not modify JSON or notify the website; browser proposals remain available for export.
- Synthetic adapter, CLI, identity, conflict, journaling, interruption, and recovery tests exercise the implementation without real-account login or mutations. Live Garmin compatibility remains unverified.

## Rebranding decisions (2026-09-17)

- Groomin is the application/repository name. New private storage defaults to `~/.groomin`, with `GROOMIN_JOURNAL_DIR` as the journal override.
- Existing private storage and the former journal environment variable remain recognized with visible warnings. Ambiguous roots or conflicting overrides fail explicitly rather than bypassing an unresolved journal. No credentials or journals are automatically moved or discarded.
- Garmin remains the external service name; the `garminconnect` dependency, `garmin_writer` module, and schema-v2 JSON contract are unchanged.

## Confirmation prompt refinement (2026-09-17)

- Blank or unrecognized confirmation input re-prompts instead of exiting. This prevents a queued newline from returning the user to the shell before they can type `APPLY`.
- Only exact uppercase `APPLY` authorizes the displayed batch. Exact uppercase `CANCEL` exits without writes; Ctrl+C and end-of-input still interrupt. No REPL or unattended approval mode is introduced.
- The shared confirmation behavior applies to both `apply` and `reconcile --apply`; all account, identity, conflict, journal, and read-back checks remain unchanged.

## Activity type editing decisions (2026-09-18)

- Extend the standalone writer to accept spec 007's schema 3 as well as existing schema 2. Support type-only and combined edits without changing fields omitted from the proposal.
- Resolve proposed type keys through the authenticated Garmin activity-type catalog during read-only review. Reject missing or ambiguous catalog entries; bind the resolved type ID, key, and parent ID to the reviewed, journaled batch. Use the pinned library's `set_activity_type` rather than assuming IDs.
- Review starting/current/proposed titles and types. Retain owned-account membership, exact activity ID, and start-time verification. A type-edit target may match either its starting type or its proposed type, to permit idempotent retry after success; unrelated types remain blocked. Title-only proposals retain strict original-type identity checks.
- Re-read remote state before each mutation. Changes since review conflict; fields already at their requested values are not replayed. Journal before every possible mutation and verify read-back of every requested field before reporting confirmation.
- Combined edits are not atomic in Garmin. Persist and reconcile partial completion, preserve unrequested fields, and require a fresh review/confirmation before completing remaining work. Authentication failure, rate limits, uncertainty, and overlapping-writer safeguards remain unchanged. Legacy title-only journals must remain recoverable.
