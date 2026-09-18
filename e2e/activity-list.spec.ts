import { expect, test } from './test'
import { expectLoaded, expectMetadataRows, gpx, point, selectZip, track, zip } from './fixtures'
import { formatActivityAverage } from '../src/units'
import { activityAverageMetric } from '../src/activity-types'

const milePoint = (miles: number, seconds: number, elevation = '') =>
  `<trkpt lat="0" lon="${miles * 1609.344 / 6_371_008.8 * 180 / Math.PI}">
    <time>${new Date(Date.UTC(2025, 0, 1) + seconds * 1000).toISOString()}</time>${elevation}</trkpt>`

test.beforeEach(async ({ page }) => {
  await page.goto('./')
})

test('explains local import and renders an accessible empty state', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Good routes. Better names.' })).toBeVisible()
  await expect(page.getByRole('img', { name: "garmoovin' logo" })).toBeVisible()
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
  await expect(page.getByRole('columnheader')).toHaveText(['Select', 'Route', 'Elevation', 'Title', 'Type', 'Date (UTC)'])
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

test('opens the exact Garmin activity in an isolated new tab without losing drafts', async ({ page, context }) => {
  const requests: { url: string; referer: string | undefined }[] = []
  await context.route('https://connect.garmin.com/**', async (route) => {
    requests.push({ url: route.request().url(), referer: route.request().headers()['referer'] })
    await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic Garmin activity</title>' })
  })
  await selectZip(page, await zip([
    ['garmin-42.gpx', gpx('<trk><name>Same name</name></trk>')],
    ['nested/GARMIN-9007199254740993.GPX', gpx('<trk><name>Same name</name></trk>')],
  ]))
  await expectLoaded(page, 2)
  const link = page.getByRole('link', { name: 'View on Garmin Connect for Same name (garmin-42.gpx) (opens in a new tab)', exact: true })
  const largeIdLink = page.getByRole('link', { name: /nested\/GARMIN-9007199254740993.GPX/ })
  await expect(page.getByRole('link')).toHaveCount(2)
  await expect(link).toHaveAttribute('href', 'https://connect.garmin.com/modern/activity/42')
  await expect(largeIdLink).toHaveAttribute('href', 'https://connect.garmin.com/modern/activity/9007199254740993')
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  const title = page.getByRole('textbox', { name: 'Title for Same name (garmin-42.gpx)', exact: true })
  await title.fill('Local draft')
  await page.getByRole('searchbox').fill('Same name')
  await expect(link).toHaveAttribute('href', 'https://connect.garmin.com/modern/activity/42')
  await title.focus()
  await page.keyboard.press('Tab')
  await expect(link).toBeFocused()
  expect(requests).toEqual([])
  const popupPromise = page.waitForEvent('popup')
  await page.keyboard.press('Enter')
  const popup = await popupPromise
  await popup.waitForLoadState()
  await expect(popup).toHaveURL('https://connect.garmin.com/modern/activity/42')
  expect(await popup.evaluate(() => window.opener === null && document.referrer === '')).toBe(true)
  expect(requests).toEqual([{ url: 'https://connect.garmin.com/modern/activity/42', referer: undefined }])
  await expect(page).toHaveURL(/\/garmoovin\/$/)
  await expect(title).toHaveValue('Local draft')
  await popup.close()
})

test('does not guess Garmin links from invalid filenames or GPX metadata', async ({ page }) => {
  const filenames = ['other.gpx', 'garmin-0.gpx', 'garmin-01.gpx', 'garmin--1.gpx', 'garmin-12abc.gpx', 'garmin-12.gpx.bak.gpx']
  await selectZip(page, await zip(filenames.map((name) => [
    name,
    gpx('<metadata><link href="https://connect.garmin.com/modern/activity/42"/></metadata><trk><name>garmin-42.gpx</name></trk>'),
  ])))
  await expectLoaded(page, filenames.length)
  await expect(page.getByRole('link')).toHaveCount(0)
  await expect(page.getByText('Garmin Connect link unavailable — no activity ID', { exact: true })).toHaveCount(filenames.length)
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

test('shows elapsed hours and minutes below the date using only valid trackpoint timestamps', async ({ page }) => {
  const cases = [
    {
      name: 'Across tracks',
      body: `<metadata><time>2030-01-01T00:00:00Z</time></metadata>
        <trk><trkseg>${point('2024-06-02T02:35:59Z')}${point('invalid')}</trkseg>
        <trkseg>${point('2024-06-01T02:00:00+02:00')}</trkseg></trk>
        <trk><trkseg>${point('2024-05-31T23:30:00Z')}</trkseg></trk>`,
      duration: '27:05',
    },
    {
      name: 'Invalid timestamps',
      body: `<trk xmlns:x="urn:synthetic"><trkseg>
        ${point('2024-02-29T12:00:00Z')}${point('2024-02-29T13:02:59Z')}
        ${point('2024-02-30T00:00:00Z')}${point('2024-02-29T24:00:00Z')}
        ${point('2024-03-01T12:00:00')}${point('2024-03-01T12:00:00+15:00')}
        ${point('2024-03-01T12:00:00-15:00')}${point('2024-03-01T12:00:00+14:01')}
        <trkpt lat="0" lon="0"><x:time>2030-01-01T00:00:00Z</x:time></trkpt>
        </trkseg></trk>`,
      duration: '01:02',
    },
    {
      name: 'Valid timezone offsets',
      body: `<trk><trkseg>${point('2024-01-01T05:30:00+05:30')}${point('2024-01-01T02:35:00-00:30')}
        ${point('2024-01-01T14:00:00+14:00')}</trkseg></trk>`,
      duration: '03:05',
    },
    {
      name: 'Subminute',
      body: `<trk><trkseg>${point('2024-01-01T00:00:00Z')}${point('2024-01-01T00:00:59Z')}</trkseg></trk>`,
      duration: '00:00',
    },
    {
      name: 'Equal timestamps',
      body: `<trk><trkseg>${point('2024-01-01T00:00:00Z')}${point('2024-01-01T00:00:00Z')}</trkseg></trk>`,
      duration: '00:00',
    },
    {
      name: 'Long activity',
      body: `<trk><trkseg><trkpt><time>2024-01-05T04:05:00Z</time></trkpt>
        <trkpt><time>2024-01-01T00:00:00Z</time></trkpt></trkseg></trk>`,
      duration: '100:05',
    },
    {
      name: 'One timestamp',
      body: `<metadata><time>2023-01-01T00:00:00Z</time></metadata>${track('', '', '2024-01-01T00:00:00Z')}`,
      duration: 'Unknown',
    },
    { name: 'Metadata only', body: '<metadata><time>2024-01-01T00:00:00Z</time></metadata>', duration: 'Unknown' },
    { name: 'No timestamps', body: '', duration: 'Unknown' },
  ]
  await selectZip(page, await zip(cases.map(({ name, body }) => [`${name}.gpx`, gpx(body)])))
  await expectLoaded(page, cases.length)
  for (const { name, duration } of cases) {
    const row = page.locator('tbody tr').filter({ has: page.locator(`.activity-name[title="${name}.gpx"]`) })
    await expect(row.locator('.activity-duration')).toHaveText(`Elapsed duration (hours:minutes): ${duration}`)
    const dateBox = await row.locator('.activity-timestamp').boundingBox()
    const durationBox = await row.locator('.activity-duration').boundingBox()
    expect(durationBox!.y).toBeGreaterThanOrEqual(dateBox!.y + dateBox!.height)
  }
})

test('keeps duration visible in matched route groups and on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await selectZip(page, await zip(['First', 'Second'].map((name, index) => [
    `garmin-${index + 1}.gpx`,
    gpx(`<trk><name>${name}</name><trkseg>
      <trkpt lat="0" lon="0"><time>2024-01-01T00:00:00Z</time></trkpt>
      <trkpt lat="0" lon="0.01"><time>2024-01-01T01:05:00Z</time></trkpt>
      </trkseg></trk>`),
  ])))
  await expectLoaded(page, 2)
  await expect(page.locator('.activity-duration')).toHaveText(Array(2).fill('Elapsed duration (hours:minutes): 01:05'))
  await page.getByRole('checkbox', { name: 'Group similar routes' }).check()
  await expect(page.locator('.route-bundle')).toHaveCount(1)
  await expect(page.locator('.route-bundle .activity-duration')).toHaveText(Array(2).fill('Elapsed duration (hours:minutes): 01:05'))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('formats elapsed averages and classifies only recognized foot and cycling types', () => {
  for (const type of ['Running', 'trail-running', 'TREADMILL RUNNING', 'track_running', 'indoor_running',
    'virtual_run', 'ultra_run', 'street_running', 'obstacle_run', 'walking', 'casual_walking',
    'speed_walking', 'hiking', 'mountaineering', 'snow_shoe']) {
    expect(activityAverageMetric(type)).toBe('pace')
  }
  for (const type of ['Cycling', 'road_biking', 'mountain-biking', 'Gravel Cycling', 'cyclocross',
    'indoor_cycling', 'virtual_ride', 'recumbent_cycling', 'hand_cycling', 'bmx',
    'downhill_biking', 'e_bike_fitness', 'e_bike_mountain']) {
    expect(activityAverageMetric(type)).toBe('speed')
  }
  for (const type of ['', 'Unknown', '999', 'future_running', 'lap_swimming', 'strength_training', 'motorcycling']) {
    expect(activityAverageMetric(type)).toBeNull()
  }
  expect(formatActivityAverage(1609.344, 599_600, 'pace')).toBe('10:00 /mi')
  expect(formatActivityAverage(1609.344, 3_661_000, 'pace')).toBe('61:01 /mi')
  expect(formatActivityAverage(1609.344, 240_000, 'speed')).toBe('15.0 mph')
  expect(formatActivityAverage(1609.344, 599_600, 'speed')).toBe('6.0 mph')
  for (const metric of ['pace', 'speed'] as const) {
    for (const invalid of [null, 0, -1, NaN, Infinity, -Infinity]) {
      expect(formatActivityAverage(invalid, 600_000, metric)).toBe('Unknown')
      expect(formatActivityAverage(1609.344, invalid, metric)).toBe('Unknown')
    }
  }
})

test('shows pace or speed without elevation, updates draft units, and restores cached averages', async ({ page }) => {
  const cases = [
    { type: 'running', seconds: 600, expected: 'Avg pace: 10:00 /mi' },
    { type: 'walking', seconds: 1200, expected: 'Avg pace: 20:00 /mi' },
    { type: 'hiking', seconds: 1500, expected: 'Avg pace: 25:00 /mi' },
    { type: 'cycling', seconds: 240, expected: 'Avg speed: 15.0 mph' },
    { type: 'mountain_biking', seconds: 360, expected: 'Avg speed: 10.0 mph' },
  ]
  const archive = await zip(cases.map(({ type, seconds }, index) => [
    `garmin-${index + 1}.gpx`,
    gpx(`<trk><name>${type}</name><type>${type}</type><trkseg>${milePoint(0, 0)}${milePoint(1, seconds)}</trkseg></trk>`),
  ]))
  await selectZip(page, archive)
  await expectLoaded(page, cases.length)
  await expect(page.getByText('No elevation data', { exact: true })).toHaveCount(cases.length)
  for (const { type, expected } of cases) {
    const row = page.locator('tbody tr').filter({ has: page.getByRole('textbox', { name: `Title for ${type} (`, exact: false }) })
    await expect(row.locator('.activity-average')).toHaveText(expected)
  }
  const first = page.locator('tbody tr').filter({ has: page.locator('.activity-name[title="garmin-1.gpx"]') })
  const editor = first.getByRole('combobox')
  await editor.focus()
  await editor.selectOption('cycling')
  await expect(first.locator('.activity-average')).toHaveText('Avg speed: 6.0 mph')
  await editor.press('Escape')
  await expect(first.locator('.activity-average')).toHaveText('Avg pace: 10:00 /mi')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('checkbox', { name: 'Group similar routes' }).check()
  await expect(page.locator('.route-bundle')).toHaveCount(1)
  await expect(page.locator('.route-bundle .activity-average')).toHaveCount(cases.length)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.reload()
  await selectZip(page, archive)
  await expectLoaded(page, cases.length)
  await expect(page.locator('.cache-summary')).toHaveText('5 from cache · 0 processed')
  await expect(first.locator('.activity-average')).toHaveText('Avg pace: 10:00 /mi')
})

test('averages respect segment and coordinate gaps, retain pauses, and handle unavailable data', async ({ page }) => {
  const cases = [
    {
      name: 'Gaps', type: 'trail_running', expected: 'Avg pace: 10:00 /mi',
      body: `<trk><trkseg>${milePoint(0, 0, '<ele>0</ele>')}${milePoint(0.25, 60, '<ele>10</ele>')}
        <trkpt lat="bad" lon="bad"/><trkpt lat="0" lon="181"/>
        ${milePoint(10, 90)}${milePoint(10.25, 120)}</trkseg>
        <trkseg>${milePoint(20, 180)}${milePoint(20.25, 240)}</trkseg></trk>
        <trk><trkseg>${milePoint(30, 300)}${milePoint(30.25, 360)}${milePoint(30.25, 600)}</trkseg></trk>`,
    },
    { name: 'Missing time', type: 'running', expected: 'Avg pace: Unknown',
      body: '<trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="1"/></trkseg></trk>' },
    { name: 'Zero time', type: 'cycling', expected: 'Avg speed: Unknown',
      body: `<trk><trkseg>${milePoint(0, 0)}${milePoint(1, 0)}</trkseg></trk>` },
    { name: 'Stationary', type: 'walking', expected: 'Avg pace: Unknown',
      body: `<trk><trkseg>${milePoint(0, 0)}${milePoint(0, 600)}</trkseg></trk>` },
    { name: 'No distance', type: 'hiking', expected: 'Avg pace: Unknown',
      body: '<trk><trkseg><trkpt><time>2025-01-01T00:00:00Z</time></trkpt><trkpt><time>2025-01-01T01:00:00Z</time></trkpt></trkseg></trk>' },
    { name: 'Isolated points', type: 'running', expected: 'Avg pace: Unknown',
      body: `<trk><trkseg>${milePoint(0, 0)}</trkseg><trkseg>${milePoint(1, 600)}</trkseg></trk>` },
    { name: 'Metadata time only', type: 'cycling', expected: 'Avg speed: Unknown',
      body: `<metadata><time>2024-01-01T00:00:00Z</time></metadata><trk><trkseg>${milePoint(0, 600)}<trkpt lat="0" lon="1"/></trkseg></trk>` },
    { name: 'Other', type: 'lap_swimming', expected: null,
      body: `<trk><trkseg>${milePoint(0, 0)}${milePoint(1, 600)}</trkseg></trk>` },
  ]
  await selectZip(page, await zip(cases.map(({ name, type, body }) => [
    `${name}.gpx`, gpx(`<trk><name>${name}</name><type>${type}</type></trk>${body}`),
  ])))
  await expectLoaded(page, cases.length)
  for (const { name, expected } of cases) {
    const row = page.locator('tbody tr').filter({ has: page.locator(`.activity-name[title="${name}.gpx"]`) })
    if (expected === null) await expect(row.locator('.activity-average')).toHaveCount(0)
    else await expect(row.locator('.activity-average')).toHaveText(expected)
  }
  const gaps = page.locator('tbody tr').filter({ has: page.locator('.activity-name[title="Gaps.gpx"]') })
  await expect(gaps.locator('.elevation-distance')).toHaveText('0 to 1 mi')
  await expect(gaps.locator('.elevation-gap')).toHaveText('Partial data / gaps')
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
