# Feature: Static GitHub Pages Client

> Publish the complete browser viewer at the repository’s GitHub Pages project path without sending private activity data or Garmin credentials to a server.

## What

Make the primary Garmin View website a fully static client deployed from Vite’s `dist` output by GitHub Actions. It must work from `/garmin-view/` and retain the local archive workflow: import a ZIP, browse route thumbnails, edit titles, and download JSON entirely in the browser.

Evolve the downloaded JSON into the self-contained handoff to the separate Garmin writer. The writer must need only this export—not the original ZIP—so the contract carries the source and Garmin identity evidence needed to verify each remote activity before any write. The hosted website never authenticates with Garmin or makes Garmin requests.

## Acceptance Criteria

- [ ] GitHub Actions builds and deploys the Vite `dist` artifact to GitHub Pages, and the app and its assets load from the `/garmin-view/` project path; generated `dist` files are not committed.
- [ ] Production-path coverage loads `/garmin-view/` and verifies ZIP import, route thumbnails, title editing, and JSON download using synthetic activity data.
- [ ] Import, parsing, thumbnails, drafts, and export remain entirely client-side. The deployed app has no backend, Garmin authentication, Garmin requests, credentials, analytics, or activity-data uploads.
- [ ] Export uses a new documented schema version and includes a required archive fingerprint plus, for every change, the full source path, Garmin activity ID evidence, recorded start time, activity type, original title, and proposed title.
- [ ] The export contract is unambiguous and validated before download: missing required identity fields or ambiguous source identity blocks affected proposals with a visible reason.
- [ ] A conforming standalone writer can verify the intended Garmin activity using only the exported JSON and remote Garmin data; it does not require the original ZIP.
- [ ] Project documentation explains GitHub Pages use, the `/garmin-view/` base path, local-only processing, sensitive browser thumbnail storage and JSON downloads, the absence of Garmin access in the hosted app, and the separate writer trust boundary.

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
