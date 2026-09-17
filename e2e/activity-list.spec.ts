import { expect, test } from './test'
import { expectLoaded, expectMetadataRows, gpx, point, selectZip, track, zip } from './fixtures'

test.beforeEach(async ({ page }) => {
  await page.goto('./')
})

test('explains local import and renders an accessible empty state', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Good routes. Better names.' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Groomin logo' })).toBeVisible()
  await expect(page.getByText('Your activities will appear here')).toBeVisible()
  await expect(page.getByText('Read in your browser. Nothing uploaded, no Garmin login.')).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Open GPX ZIP')).toBeFocused()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('loads nested GPX files and preserves duplicate names in newest-first order', async ({ page }) => {
  const archive = await zip([
    ['z.gpx', gpx(track('Same name', 'trail_running', '2025-01-01T00:00:00Z'))],
    ['nested/a.GPX', gpx(track('Same name', 'hiking', '2025-01-01T00:00:00Z'))],
    ['new.gpx', gpx(track('Latest activity', 'cycling', '2025-01-02T02:00:00+01:00'))],
    ['unknown.gpx', gpx('<trk><name>Undated</name></trk>')],
    ['notes.txt', 'Not an activity'],
  ])
  await selectZip(page, archive)
  await expectLoaded(page, 4)
  await expect(page.getByRole('columnheader')).toHaveText(['Route', 'Elevation', 'Title', 'Type', 'Date (UTC)'])
  await expectMetadataRows(page, [
    'Latest activityCycling2025-01-02 01:00:00',
    'Same nameHiking2025-01-01 00:00:00',
    'Same nameTrail Running2025-01-01 00:00:00',
    'UndatedUnknownUnknown',
  ])
})

test('uses name fallbacks and retains unrecognized activity types', async ({ page }) => {
  await selectZip(page, await zip([
    ['a.gpx', gpx('<metadata><name>Metadata name</name></metadata><trk><name>Track name</name><type>999</type></trk>')],
    ['b.gpx', gpx('<metadata><name>Metadata only</name></metadata><trk><name> </name><type>future_sport</type></trk>')],
    ['nested/c.gpx', gpx()],
    ['d.gpx', '<g:gpx xmlns:g="http://www.topografix.com/GPX/1/1"><g:trk><g:name>Prefixed</g:name><g:type>walking</g:type></g:trk></g:gpx>'],
    ['e.gpx', '<gpx version="1.0" xmlns="http://www.topografix.com/GPX/1/0"><name>Legacy name</name><time>2000-01-01T00:00:00Z</time></gpx>'],
    ['f.gpx', '<gpx><trk><name>No namespace</name><type>hiking</type></trk></gpx>'],
  ]))
  await expectLoaded(page, 6)
  await expectMetadataRows(page, [
    'Legacy nameUnknown2000-01-01 00:00:00',
    'Track name999Unknown',
    'Metadata onlyFuture SportUnknown',
    'PrefixedWalkingUnknown',
    'No namespaceHikingUnknown',
    'c.gpxUnknownUnknown',
  ])
})

test('uses the earliest valid trackpoint across tracks and segments, not export dates', async ({ page }) => {
  await selectZip(page, await zip([
    ['a.gpx', gpx(`<metadata><time>2030-01-01T00:00:00Z</time></metadata>
      <trk><name>Earliest point</name><trkseg>${point('2024-06-02T00:00:00Z')}${point('invalid')}</trkseg>
      <trkseg>${point('2024-06-01T02:00:00+02:00')}</trkseg></trk>
      <trk><trkseg>${point('2024-05-31T23:30:00Z')}</trkseg></trk>`)],
    ['b.gpx', gpx(`<metadata><time>2024-02-29T12:00:00Z</time></metadata><trk><name>Metadata fallback</name><trkseg>${point('2023-02-29T00:00:00Z')}${point('2024-02-30T00:00:00Z')}${point('2024-02-29T24:00:00Z')}</trkseg></trk>`)],
    ['c.gpx', gpx(track('No timezone', '', '2024-06-01T12:00:00'))],
    ['d.gpx', gpx('<metadata><time>2024-13-01T00:00:00Z</time></metadata><trk><name>Bad metadata</name></trk>')],
  ]))
  await expectLoaded(page, 4)
  await expectMetadataRows(page, [
    'Earliest pointUnknown2024-05-31 23:30:00',
    'Metadata fallbackUnknown2024-02-29 12:00:00',
    'No timezoneUnknownUnknown',
    'Bad metadataUnknownUnknown',
  ])
})

test('ignores foreign extension names and times', async ({ page }) => {
  await selectZip(page, await zip([['extension.gpx', gpx(`
    <metadata><name>Actual name</name><time>2024-01-01T00:00:00Z</time></metadata>
    <trk xmlns:x="urn:synthetic"><x:name>Not the activity name</x:name><x:type>Not the activity type</x:type>
    <trkseg><trkpt lat="0" lon="0"><x:time>2030-01-01T00:00:00Z</x:time></trkpt></trkseg></trk>`)] ]))
  await expectLoaded(page, 1)
  await expectMetadataRows(page, ['Actual nameUnknown2024-01-01 00:00:00'])
})

test('reports malformed and non-GPX documents without losing readable activities', async ({ page }) => {
  await selectZip(page, await zip([
    ['valid.gpx', gpx()],
    ['broken.gpx', '<gpx><trk>'],
    ['wrong.gpx', '<html><body>Not GPX</body></html>'],
    ['dtd.gpx', '<!DOCTYPE gpx [<!ENTITY label "example">]><gpx><trk><name>&label;</name></trk></gpx>'],
  ]))
  await expectLoaded(page, 1, 3)
  await expect(page.getByRole('heading', { name: '3 files skipped' })).toBeVisible()
  await expect(page.locator('.notice li')).toContainText(['broken.gpx: Malformed XML', 'wrong.gpx: Not a GPX document', 'dtd.gpx: GPX documents with a DOCTYPE'])
})

test('distinguishes empty, non-GPX, all-invalid, and unreadable archives', async ({ page }) => {
  await selectZip(page, await zip([]))
  await expect(page.getByRole('heading', { name: 'No GPX files found' })).toBeVisible()
  await selectZip(page, await zip([['notes.txt', 'empty of GPX']]))
  await expect(page.getByRole('heading', { name: 'No GPX files found' })).toBeVisible()
  await selectZip(page, await zip([['bad.gpx', 'not XML']]))
  await expect(page.getByRole('heading', { name: 'No readable activities' })).toBeVisible()
  await selectZip(page, Buffer.from('not a ZIP'))
  await expect(page.getByRole('alert')).toContainText('Unable to open ZIP')
  await expect(page.getByRole('heading', { name: '1 file skipped' })).toHaveCount(0)
  await selectZip(page, await zip([['ok.gpx', gpx()]]))
  await expectLoaded(page, 1)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('reports encrypted entries rather than asking for or storing passwords', async ({ page }) => {
  await selectZip(page, await zip([['locked.gpx', gpx()]], { password: 'synthetic-only-password' }))
  await expectLoaded(page, 0, 1)
  await expect(page.locator('.notice li')).toContainText('Password-protected GPX')
})

test('detects checksum corruption in one file and continues importing others', async ({ page }) => {
  const archive = await zip([
    ['broken.gpx', gpx(track('Before corruption', '', '2024-01-01T00:00:00Z'))],
    ['ok.gpx', gpx()],
  ], { level: 0 })
  const offset = archive.indexOf('Before corruption')
  expect(offset).toBeGreaterThan(0)
  archive[offset] = 'X'.charCodeAt(0)
  await selectZip(page, archive)
  await expectLoaded(page, 1, 1)
  await expect(page.locator('.notice li')).toContainText('broken.gpx')
})

test('replacing an in-progress archive cancels its updates and clears issues', async ({ page }) => {
  const archive = await zip([
    ['bad.gpx', 'broken'],
    ...Array.from({ length: 150 }, (_, i): [string, string] => [`old-${i}.gpx`, gpx(track('Old activity', 'hiking', '2024-01-01T00:00:00Z'))]),
  ])
  await selectZip(page, archive, 'old.zip')
  await expect(page.getByRole('status')).toContainText('Reading GPX files:')
  await selectZip(page, await zip([['new.gpx', gpx(track('Replacement', 'walking', '2025-01-01T00:00:00Z'))]]), 'new.zip')
  await expectLoaded(page, 1)
  await expectMetadataRows(page, ['ReplacementWalking2025-01-01 00:00:00'])
  await expect(page.locator('.notice')).toHaveCount(0)
  await expect(page.locator('.archive-name')).toHaveText('Archive: new.zip')
  await page.waitForTimeout(800)
  await expectLoaded(page, 1)
})

test('imports hundreds of metadata-only activities without network requests or persistence', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await selectZip(page, await zip(Array.from({ length: 467 }, (_, i) => [
    `activity-${i}.gpx`,
    gpx(track(`Synthetic activity ${i}`, 'hiking', '2025-01-01T00:00:00Z')),
  ])))
  await expectLoaded(page, 467)
  expect(requests).toEqual([])
  expect(await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    databases: (await indexedDB.databases()).length,
  }))).toEqual({ local: 0, session: 0, databases: 0 })
  await page.reload()
  await expect(page.getByText('Your activities will appear here')).toBeVisible()
})

test('renders imported text safely and fits a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await selectZip(page, await zip([['safe.gpx', gpx(track('&lt;img src="https://example.invalid/x" onerror="alert(1)"&gt;', 'long_unrecognized_activity_type', '2025-01-01T00:00:00Z'))]]))
  await expectLoaded(page, 1)
  await expect(page.locator('tbody img')).toHaveCount(0)
  await expect(page.locator('.activity-name')).toHaveValue(/<img/)
  expect(requests).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
