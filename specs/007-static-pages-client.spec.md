# Feature: Static GitHub Pages Client

> Publish the complete browser viewer at the repository’s GitHub Pages project path without sending private activity data or Garmin credentials to a server.

## What

Make the primary Groomin website a fully static client deployed from Vite’s `dist` output by GitHub Actions. It must work from `/groomin/` and retain the local archive workflow: import a ZIP, browse route thumbnails, edit titles, and download JSON entirely in the browser.

Evolve the downloaded JSON into the self-contained handoff to the separate Garmin writer. The writer must need only this export—not the original ZIP—so the contract carries the source and Garmin identity evidence needed to verify each remote activity before any write. The hosted website never authenticates with Garmin or makes Garmin requests.

## Acceptance Criteria

- [ ] GitHub Actions builds and deploys the Vite `dist` artifact to GitHub Pages, and the app and its assets load from the `/groomin/` project path; generated `dist` files are not committed.
- [x] Production-path coverage loads `/groomin/` and verifies ZIP import, route thumbnails, title editing, and JSON download using synthetic activity data.
- [x] Import, parsing, thumbnails, drafts, and export remain entirely client-side. The deployed app has no backend, Garmin authentication, Garmin requests, credentials, analytics, or activity-data uploads.
- [x] Export uses a new documented schema version and includes a required archive fingerprint plus, for every change, the full source path, Garmin activity ID evidence, recorded start time, activity type, original title, and proposed title.
- [x] The export contract is unambiguous and validated before download: missing required identity fields or ambiguous source identity blocks affected proposals with a visible reason.
- [x] A conforming standalone writer can verify the intended Garmin activity using only the exported JSON and remote Garmin data; it does not require the original ZIP.
- [x] Project documentation explains GitHub Pages use, the `/groomin/` base path, local-only processing, sensitive browser thumbnail storage and JSON downloads, the absence of Garmin access in the hosted app, and the separate writer trust boundary.

## Scope

### In scope
- Static GitHub Pages deployment, project-path configuration, production-path coverage, the self-contained versioned export contract, and deployment/privacy documentation.

### Out of scope
- Garmin authentication, reads, writes, or credentials in the hosted website.
- Implementing or distributing the standalone Garmin writer, changing GPX recordings, or committing build output.

## Notes

- The next export version supersedes spec 004’s version 1 handoff where needed. Preserve `archiveFingerprint`, `sourceFile`, and original/proposed titles while adding the required Garmin ID evidence, recorded start time, and activity type; document exact field names and nullability with the implementation.
- Garmin ID evidence is a candidate identity claim, not authorization to write. The standalone writer must independently verify it against remote identity data, present the proposed changes for review, require explicit confirmation, journal the operation, write only the title, and read the title back.
- This separation supports the manifesto’s privacy and trustworthy-write-back principles: hosting serves code only, while sensitive Garmin access remains an explicit local operation.

## Implementation decisions

- Vite's base path and the browser test server use `/groomin/`. The `Deploy Pages` workflow runs on `main`, gates its `dist` upload on the browser suite, and deploys that artifact using GitHub Pages' environment and scoped deployment permissions. Pages must be enabled with GitHub Actions as the source before hosted deployment.
- The website has no Garmin API client, auth controls, result synchronization, proxy, or backend. Spec 006's grouping behavior remains intact.
- Schema version **2** has exactly `schemaVersion`, `archiveFingerprint` (64 lowercase SHA-256 hex characters), and nonempty `changes`. Each change requires non-null `sourceFile`, `garminActivityId`, `recordedStartTime`, `activityType`, `originalTitle`, and `newTitle`. See README for the exact constraints and writer commands.
- `garminActivityId` is a positive decimal string derived from the `garmin-<id>.gpx` basename; `recordedStartTime` is the viewer's recorded date in UTC `YYYY-MM-DDTHH:mm:ss.sssZ`, year 0001–9999. Unknown dates/types or unverifiable IDs block affected drafts. Preserve full source paths and original/proposed titles.
- Duplicate source paths or proposed target IDs block the export. Visible per-source reasons include hidden drafts. Block the whole download rather than silently omit proposals; preserve all drafts for correction. The UTF-8 JSON limit is 1 MiB in both units.
- The fingerprint is provenance only, not a signature or remotely verified identity. The spec-005 writer validates all supplied evidence and owns the Garmin trust boundary; it requires no original ZIP. Version 1 must be re-exported, not inferred.
- A shared synthetic JSON fixture is checked against the actual project-path browser download and accepted by CLI tests. Browser coverage verifies import, route previews, hidden title proposals, static asset paths, absent Garmin controls, and no uploads or non-static HTTP requests.

## Rebranding decisions (2026-09-17)

- Rename the repository, app title, package metadata, documentation, and production-path tests to Groomin. GitHub repository and `origin` use `natoverse/groomin`.
- The Pages project path is `/groomin/` and the site address is `https://natoverse.github.io/groomin/`. Deploy only the static build as before; the local writer remains separate.

## Deployment iteration decisions (2026-09-17)

- Superseding the original deployment test gate, `Deploy Pages` runs `npm ci` and `npm run build` before uploading `dist`, without installing Playwright browsers or running `npm test`. The build remains explicit because the browser suite previously invoked it through its web server configuration.
- Browser coverage remains in the `Check` workflow for pull requests and pushes; deployment does not repeat those tests.

## Supplied design decisions (2026-09-17)

- Restyle the existing viewer using the supplied cream/brown/rust/amber/olive tokens, rounded panels, offset shadows, and readable focus/error/disabled states. Keep imports, filtering, grouping, drafts, export, and the standalone writer unchanged.
- Display the supplied logo at the top of the app and README. Commit only the extracted public theme and optimized logo; keep the design ZIP ignored and do not ship its example HTML or support script.
- Load Bagel Fat One, Hanken Grotesk, and Space Mono using the supplied Google Fonts CDN link with `display=swap` and local fallbacks. This explicitly permits public typography requests to Google's font domains, not activity uploads, analytics, or Garmin access. Document connection metadata and suppress referrers.
- Preserve the `/groomin/` build path, accessible keyboard controls, contained mobile tables, and reduced-motion preferences. Browser tests stub the font service to verify fallback behavior without relying on external availability.
