import { expect, test, type Page } from './test'
import { expectLoaded, gpx, selectZip, zip } from './fixtures'

declare global {
  interface Window {
    elevationProbe: {
      parses: number
      renders: number
      holdTimers: boolean
      timers: (() => void)[]
      failProfile: boolean
    }
  }
}

const point = (lon: number | string, elevation: string | null, lat = '0') =>
  `<trkpt lat="${lat}" lon="${lon}">${elevation === null ? '' : `<ele>${elevation}</ele>`}<time>2025-01-01T00:00:00Z</time></trkpt>`
const route = (name = 'Recorded hills', elevations = ['-10', '30', '0'], type = 'hiking') =>
  gpx(`<trk><name>${name}</name><type>${type}</type><trkseg>${elevations.map((value, i) => point(i * 0.001, value)).join('')}</trkseg></trk>`)
const row = (page: Page, path: string) => page.locator('tbody tr').filter({ has: page.locator(`.activity-name[title="${path}"]`) })
const profilePath = (page: Page, path: string) => row(page, path).locator('.elevation-preview path')

async function expectMatchingPreviews(page: Page, width = 120, height = 80) {
  const count = await page.locator('tbody tr').count()
  expect(count).toBeGreaterThan(0)
  await expect.poll(() => page.locator('.route-preview, .elevation-preview').evaluateAll((elements) =>
    elements.map((element) => {
      const bounds = element.getBoundingClientRect()
      return [bounds.width, bounds.height]
    }),
  )).toEqual(Array.from({ length: count * 2 }, () => [width, height]))
}

async function installProbe(page: Page) {
  await page.addInitScript(() => {
    window.elevationProbe = { parses: 0, renders: 0, holdTimers: false, timers: [], failProfile: false }
    const parse = DOMParser.prototype.parseFromString
    DOMParser.prototype.parseFromString = function (...args) {
      window.elevationProbe.parses++
      return parse.apply(this, args)
    }
    const render = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      window.elevationProbe.renders++
      render.apply(this, args)
    }
    const format = Number.prototype.toFixed
    Number.prototype.toFixed = function (digits) {
      if (window.elevationProbe.failProfile && digits === 2) {
        window.elevationProbe.failProfile = false
        throw new Error('Synthetic elevation drawing failure.')
      }
      return format.call(this, digits)
    }
    const timer = window.setTimeout.bind(window)
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (window.elevationProbe.holdTimers && (!delay || delay <= 10) && typeof handler === 'function') {
        window.elevationProbe.timers.push(() => handler(...args))
        return 0
      }
      return timer(handler, delay, ...args)
    }) as typeof window.setTimeout
  })
}

async function releaseTimers(page: Page) {
  await page.evaluate(() => {
    window.elevationProbe.holdTimers = false
    for (const callback of window.elevationProbe.timers.splice(0)) callback()
  })
}

test('places a labeled recorded profile beside each route with separate missing and flat states', async ({ page }) => {
  await page.goto('./')
  await selectZip(page, await zip([
    ['hills.gpx', route()],
    ['flat.gpx', route('Flat below sea level', ['-5', '-5'])],
    ['small-range.gpx', route('Small range', ['100.001', '100.002'])],
    ['no-elevation.gpx', gpx(`<trk><name>No measurements</name><trkseg>${point(0, null)}${point(0.001, null)}</trkseg></trk>`)],
    ['no-route.gpx', gpx('<trk><name>No route</name></trk>')],
    ['stationary.gpx', gpx(`<trk><name>Stationary</name><trkseg>${point(0, '10')}${point(0, '20')}</trkseg></trk>`)],
  ]))
  await expectLoaded(page, 6)
  await expect(page.getByRole('columnheader')).toHaveText(['Route', 'Elevation', 'Title', 'Type', 'Date (UTC)'])
  await expect(profilePath(page, 'hills.gpx')).toHaveAttribute('d', 'M3.00,61.00 L90.00,3.00 L177.00,46.50')
  await expect(profilePath(page, 'hills.gpx')).toHaveCSS('stroke', 'rgb(94, 122, 112)')
  await expect(row(page, 'hills.gpx').getByRole('img', { name: 'Elevation profile for Recorded hills: -32.81 to 98.43 ft over 0 to 0.14 mi' })).toBeVisible()
  await expect(profilePath(page, 'flat.gpx')).toHaveAttribute('d', 'M3.00,32.00 L177.00,32.00')
  await expect(row(page, 'flat.gpx').locator('.elevation-range')).toHaveText('-16.4 to -16.4 ft')
  await expect(row(page, 'small-range.gpx').locator('.elevation-range')).toHaveText('328.08727034120733 to 328.09055118110234 ft')
  for (const file of ['no-elevation.gpx', 'no-route.gpx', 'stationary.gpx']) {
    await expect(row(page, file).locator('.elevation-preview')).toHaveText('No elevation data')
  }
  await expect(row(page, 'no-elevation.gpx').getByRole('img', { name: 'Route preview for No measurements' })).toBeVisible()
  await expect(row(page, 'no-route.gpx').locator('.route-preview')).toHaveText('No route')
  await expectMatchingPreviews(page)
  await expect(row(page, 'hills.gpx').locator('.activity-details .elevation-range')).toHaveText('-32.81 to 98.43 ft')
  await expect(row(page, 'hills.gpx').locator('.activity-details .elevation-distance')).toHaveText('0 to 0.14 mi')
  await expect(page.getByText('North-up route previews and recorded elevation in feet over distance in miles.', { exact: false })).toBeVisible()
  await expect(page.locator('.elevation-preview .activity-stats, .elevation-preview .elevation-range, .elevation-preview .elevation-distance')).toHaveCount(0)
  await expect(row(page, 'no-elevation.gpx').locator('.activity-stats')).toHaveCount(0)
})

test('displays mile-scale distances and finite extreme elevations in imperial units', async ({ page }) => {
  await page.goto('./')
  const mileLongitude = 1609.344 / 6_371_008.8 * 180 / Math.PI
  const extreme = `1${'0'.repeat(308)}`
  await selectZip(page, await zip([
    ['mile.gpx', gpx(`<trk><name>One mile</name><trkseg>${point(0, '0')}${point(mileLongitude, '1609.344')}</trkseg></trk>`)],
    ['extreme.gpx', route('Extreme elevations', [`-${extreme}`, extreme])],
    ['tiny.gpx', gpx(`<trk><name>Tiny distance</name><trkseg>${point(0, '0')}${point((mileLongitude / 1_000_000).toFixed(14), '0')}</trkseg></trk>`)],
  ]))
  await expectLoaded(page, 3)
  await expect(row(page, 'mile.gpx').locator('.elevation-range')).toHaveText('0 to 5280 ft')
  await expect(row(page, 'mile.gpx').locator('.elevation-distance')).toHaveText('0 to 1 mi')
  await expect(row(page, 'extreme.gpx').getByRole('img', { name: 'Elevation profile for Extreme elevations: -3.28e+308 to 3.28e+308 ft over 0 to 0.07 mi' })).toBeVisible()
  await expect(row(page, 'tiny.gpx').locator('.elevation-range')).toHaveText('0 to 0 ft')
  await expect(row(page, 'tiny.gpx').locator('.elevation-distance')).toHaveText('0 to 1.00e-6 mi')
})

test('parsing preserves boundaries, elevation gaps, and duplicate positions without changing route geometry', async ({ page }) => {
  await page.goto('./')
  const points = [
    point(0, '0'), point(0.001, '10'), point(0.001, null), point(0.002, '20'), point(0.003, '30'),
    point(0.004, '40', 'invalid'), point(10, '40'), point(10.001, '50'),
  ].join('')
  const contents = gpx(`<trk><name>Disconnected</name><trkseg>${points}</trkseg>
    <trkseg>${point(20, '60')}${point(20.001, '70')}</trkseg></trk>
    <trk><trkseg>${point(30, '80')}${point(30.001, '90')}</trkseg></trk>`)
  await selectZip(page, await zip([['segments.gpx', contents]]))
  await expectLoaded(page, 1)
  const path = await profilePath(page, 'segments.gpx').getAttribute('d')
  expect(path?.match(/M/g)).toHaveLength(5)
  expect(path?.match(/L/g)).toHaveLength(5)
  const xs = path!.split(' ').map((command) => Number(command.slice(1).split(',')[0]))
  expect(xs).toEqual([3, 32, 61, 90, 90, 119, 119, 148, 148, 177])
  await expect(page.locator('.elevation-distance')).toHaveText('0 to 0.41 mi')
  await expect(page.locator('.elevation-gap')).toHaveText('Partial data / gaps')
  await expect(page.getByRole('img', { name: 'Route preview for Disconnected' })).toBeVisible()
})

test('accepts GPX namespaces and only finite decimal elevations from the trackpoint namespace', async ({ page }) => {
  await page.goto('./')
  const invalid = [null, '', ' ', 'bad', 'NaN', 'Infinity', '-Infinity', '0x10', '1e3', '9'.repeat(400)]
  const files: [string, string][] = invalid.map((value, index) => [
    `gap-${index}.gpx`,
    gpx(`<trk><name>Gap ${index}</name><trkseg>${point(0, '0')}${point(0.001, '10')}${point(0.002, value)}${point(0.003, '20')}${point(0.004, '30')}</trkseg></trk>`),
  ])
  for (const [index, namespace] of ['', 'http://www.topografix.com/GPX/1/0', 'http://www.topografix.com/GPX/1/1'].entries()) {
    files.push([`namespace-${index}.gpx`, `<gpx${namespace ? ` xmlns="${namespace}"` : ''} xmlns:ext="urn:foreign">
      <trk><name>Namespace ${index}</name><trkseg>
      <trkpt lat="0" lon="0"><ext:ele>9999</ext:ele><ele>+0.0</ele></trkpt>
      <trkpt lat="0" lon="0.001"><extensions><ext:ele>9999</ext:ele></extensions><ele>-.5</ele></trkpt>
      </trkseg></trk></gpx>`])
  }
  files.push(['foreign.gpx', '<gpx xmlns:ext="urn:foreign"><trk><trkseg><trkpt lat="0" lon="0"><ext:ele>1</ext:ele></trkpt><trkpt lat="0" lon="1"><ext:ele>2</ext:ele></trkpt></trkseg></trk></gpx>'])
  await selectZip(page, await zip(files))
  await expectLoaded(page, files.length)
  for (let index = 0; index < invalid.length; index++) {
    const path = await profilePath(page, `gap-${index}.gpx`).getAttribute('d')
    expect(path?.match(/M/g)).toHaveLength(2)
    expect(path?.match(/L/g)).toHaveLength(2)
    await expect(row(page, `gap-${index}.gpx`).locator('.elevation-gap')).toBeVisible()
  }
  for (let index = 0; index < 3; index++) {
    await expect(row(page, `namespace-${index}.gpx`).locator('.elevation-range')).toHaveText('-1.64 to 0 ft')
  }
  await expect(row(page, 'foreign.gpx').locator('.elevation-preview')).toHaveText('No elevation data')
})

test('profiles follow duplicate-name activities through drafts, filters, grouping, and unchanged JSON exports', async ({ page }) => {
  await installProbe(page)
  await page.goto('./')
  await selectZip(page, await zip([
    ['garmin-1.gpx', route('Same name')],
    ['garmin-2.gpx', route('Same name', ['10', '10', '10'], 'running')],
    ['garmin-3.gpx', route('Other name', ['100', '0', '100'])],
  ]))
  await expectLoaded(page, 3)
  const first = await profilePath(page, 'garmin-1.gpx').getAttribute('d')
  const second = await profilePath(page, 'garmin-2.gpx').getAttribute('d')
  expect(first).not.toBe(second)
  const drafts = page.getByRole('textbox', { name: 'Title for Same name (garmin-1.gpx)', exact: true })
  await drafts.fill('Keep this proposal')
  await page.getByRole('checkbox', { name: 'Group similar routes' }).check()
  await expect(page.locator('.similarity-count')).toContainText('1 route bundle')
  await expect(page.locator('.similarity-count')).not.toContainText('Analysis pending')
  await expect(row(page, 'garmin-1.gpx').locator('.elevation-range')).toHaveText('-32.81 to 98.43 ft')
  await expect(row(page, 'garmin-1.gpx').locator('.elevation-distance')).toHaveText('0 to 0.14 mi')
  await expect(row(page, 'garmin-2.gpx').getByRole('img', { name: 'Elevation profile for Same name: 32.81 to 32.81 ft over 0 to 0.14 mi' })).toBeVisible()
  await page.getByRole('searchbox').fill('same')
  await page.getByRole('button', { name: 'Hiking', exact: true }).click()
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(profilePath(page, 'garmin-2.gpx')).toHaveAttribute('d', second!)
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save JSON (1)' }).click()
  const stream = await (await downloading).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const mapping = JSON.parse(Buffer.concat(chunks).toString())
  expect(mapping.schemaVersion).toBe(2)
  expect(mapping.changes).toEqual([{
    sourceFile: 'garmin-1.gpx', garminActivityId: '1', recordedStartTime: '2025-01-01T00:00:00.000Z',
    activityType: 'Hiking', originalTitle: 'Same name', newTitle: 'Keep this proposal',
  }])
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await page.getByRole('searchbox').fill('')
  await page.getByRole('checkbox', { name: 'Group similar routes' }).uncheck()
  await expect(profilePath(page, 'garmin-1.gpx')).toHaveAttribute('d', first!)
  await expect(profilePath(page, 'garmin-2.gpx')).toHaveAttribute('d', second!)
  await expect(drafts).toHaveValue('Keep this proposal')
  await expect(row(page, 'garmin-1.gpx').locator('.activity-details .elevation-range')).toHaveText('-32.81 to 98.43 ft')
  await expect(row(page, 'garmin-2.gpx').locator('.activity-details .elevation-range')).toHaveText('32.81 to 32.81 ft')
  await page.getByRole('searchbox').fill('Elevation:')
  await expect(page.locator('tbody tr')).toHaveCount(0)
  await page.getByRole('searchbox').fill('same')
  await expect(page.locator('tbody tr')).toHaveCount(2)
  expect(await page.evaluate(() => window.elevationProbe.parses)).toBe(3)
})

test('cached profiles remain until clearing; processing and storage failures keep fresh profiles usable', async ({ page }) => {
  await installProbe(page)
  await page.goto('./')
  await selectZip(page, await zip([['garmin-1.gpx', route()]]))
  await expectLoaded(page, 1)
  expect(await page.evaluate(() => window.elevationProbe.renders)).toBe(1)
  expect(await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('groomin-activities')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise((resolve, reject) => {
        const request = database.transaction('activities').objectStore('activities').getAll()
        request.onsuccess = () => resolve(request.result[0].elevation)
        request.onerror = () => reject(request.error)
      })
    } finally {
      database.close()
    }
  })).toMatchObject({ minElevation: -10, maxElevation: 30, distance: expect.closeTo(222.39016, 4) })
  await page.reload()
  await expect(page.locator('tbody tr')).toHaveCount(0)
  const requests: string[] = []
  page.on('request', (request) => { if (/^https?:/.test(request.url())) requests.push(request.url()) })
  const changed = await zip([['garmin-1.gpx', route('Changed elevation', ['100', '0', '100'])]])
  await selectZip(page, changed)
  await expectLoaded(page, 1)
  expect(await page.evaluate(() => window.elevationProbe.renders)).toBe(0)
  expect(await page.evaluate(() => window.elevationProbe.parses)).toBe(0)
  await expect(page.locator('.elevation-range')).toHaveText('-32.81 to 98.43 ft')
  await expect(page.locator('.elevation-distance')).toHaveText('0 to 0.14 mi')
  const path = await profilePath(page, 'garmin-1.gpx').getAttribute('d')
  await page.getByRole('button', { name: 'Clear activity cache' }).click()
  await expect(page.locator('.cache-notice')).toContainText('Activity cache cleared')
  await expect(profilePath(page, 'garmin-1.gpx')).toHaveAttribute('d', path!)
  await page.evaluate(() => {
    IDBDatabase.prototype.transaction = () => { throw new Error('Synthetic storage failure.') }
    HTMLCanvasElement.prototype.toBlob = (callback) => callback(null)
  })
  await selectZip(page, changed)
  await expectLoaded(page, 1)
  await expect(page.locator('.route-preview')).toHaveText('Thumbnail unavailable')
  await expect(page.locator('.cache-warning')).toContainText('Synthetic storage failure')
  await expect(page.locator('.elevation-range')).toHaveText('0 to 328.08 ft')
  await expect(profilePath(page, 'garmin-1.gpx')).not.toHaveAttribute('d', path!)
  expect(requests).toEqual([])
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0)
  expect(await page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name))).toEqual(['groomin-activities'])
})

test('pending large imports remain usable and replacement prevents stale profiles', async ({ page }) => {
  await installProbe(page)
  await page.goto('./')
  const large = await zip(Array.from({ length: 300 }, (_, index) => [`${index}.gpx`, route(`Old ${index}`)]))
  await page.evaluate(() => { window.elevationProbe.holdTimers = true })
  await selectZip(page, large)
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(page.getByLabel('Preparing elevation... for Old 0', { exact: true })).toBeVisible()
  await expectMatchingPreviews(page)
  const draft = page.getByRole('textbox', { name: 'Title for Old 0 (0.gpx)', exact: true })
  await draft.fill('Unsaved draft')
  await page.getByRole('searchbox').fill('old')
  const replacement = await zip([['fresh.gpx', route('Fresh', ['0', '0'])]])
  page.once('dialog', (dialog) => dialog.dismiss())
  await selectZip(page, replacement)
  await expect(draft).toHaveValue('Unsaved draft')
  page.once('dialog', (dialog) => dialog.accept())
  await selectZip(page, replacement)
  await releaseTimers(page)
  await expectLoaded(page, 1)
  await expect(page.locator('.activity-name')).toHaveValue('Fresh')
  await expect(page.getByRole('img', { name: /^Elevation profile for Fresh:/ })).toBeVisible()
  await expect(page.getByRole('img', { name: /^Elevation profile for Old/ })).toHaveCount(0)
  await expect(page.getByRole('textbox')).toHaveValue('Fresh')
})

test('profile processing failures are visible without losing metadata, maps, or other profiles', async ({ page }) => {
  await installProbe(page)
  await page.goto('./')
  await page.evaluate(() => { window.elevationProbe.failProfile = true })
  await selectZip(page, await zip([
    ['broken.gpx', route('Broken profile')], ['missing.gpx', gpx()], ['healthy.gpx', route('Healthy')],
  ]))
  await expectLoaded(page, 3)
  await expect(row(page, 'broken.gpx').locator('.elevation-error')).toHaveText('Elevation unavailable')
  await expectMatchingPreviews(page)
  await expect(page.getByLabel('Elevation unavailable for Broken profile: Synthetic elevation drawing failure.', { exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Route preview for Broken profile' })).toBeVisible()
  await expect(row(page, 'broken.gpx').getByRole('textbox')).toBeEnabled()
  await expect(row(page, 'missing.gpx').locator('.elevation-preview')).toHaveText('No elevation data')
  await expect(page.getByRole('img', { name: /^Elevation profile for Healthy:/ })).toBeVisible()
  await selectZip(page, await zip([['valid.gpx', route('Recovered')]]))
  await expectLoaded(page, 1)
  await expect(page.getByRole('img', { name: /^Elevation profile for Recovered:/ })).toBeVisible()
})

for (const { width, widerFont } of [320, 600, 601, 768, 1440].flatMap((width) =>
  [false, true].map((widerFont) => ({ width, widerFont })),
)) {
  test(`profiles and labels remain reachable in the scrollable table at ${width}px${widerFont ? ' with a wider fallback font' : ''}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('./')
    if (widerFont) await page.addStyleTag({ content: '.type-label { font-family: monospace; letter-spacing: 1px; }' })
    await selectZip(page, await zip([
      ['route.gpx', route()],
      ['partial.gpx', route('Partial', ['0', '10', '', '20', '30'])],
      ['flat.gpx', route('Flat', ['10', '10'])],
      ['missing.gpx', gpx()],
    ]))
    await expectLoaded(page, 4)
    await expectMatchingPreviews(page, width <= 600 ? 90 : 120, width <= 600 ? 60 : 80)
    const preview = row(page, 'route.gpx').getByRole('img', { name: /^Elevation profile for/ })
    await preview.scrollIntoViewIfNeeded()
    await expect(preview).toBeInViewport()
    expect(await preview.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await expect(page.locator('.elevation-preview .elevation-gap')).toHaveCount(0)
    await expect(row(page, 'partial.gpx').locator('.activity-details .elevation-gap')).toHaveText('Partial data / gaps')
    expect(await preview.textContent()).toBe('')
    const details = row(page, 'route.gpx').locator('.activity-details')
    await details.scrollIntoViewIfNeeded()
    for (const label of ['.elevation-range', '.elevation-distance']) {
      await expect(details.locator(label)).toBeInViewport()
      expect(await details.locator(label).evaluate((element) => element.getBoundingClientRect().width <= element.parentElement!.getBoundingClientRect().width)).toBe(true)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const badge = await row(page, 'route.gpx').locator('select.type-label').evaluate((element: HTMLSelectElement) => {
      const style = getComputedStyle(element)
      const context = document.createElement('canvas').getContext('2d')!
      context.font = style.font
      context.letterSpacing = style.letterSpacing
      const text = context.measureText(element.selectedOptions[0]!.textContent ?? '')
      return {
        height: element.clientHeight,
        oneLineHeight: Math.ceil(Math.max(
          parseFloat(style.minHeight) - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth),
          text.fontBoundingBoxAscent + text.fontBoundingBoxDescent + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
        )),
        width: element.clientWidth,
        font: style.fontFamily,
        textWidth: text.width,
        availableTextWidth: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 20,
      }
    })
    expect(badge.height, JSON.stringify(badge)).toBeLessThanOrEqual(badge.oneLineHeight)
    expect(badge.textWidth, JSON.stringify(badge)).toBeLessThanOrEqual(badge.availableTextWidth)
    await page.getByRole('region', { name: 'Scrollable activity list' }).focus()
    await expect(page.getByRole('region', { name: 'Scrollable activity list' })).toBeFocused()
  })
}

test('long unrecognized activity types remain available in bounded inline selectors', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto('./')
  const type = 'X'.repeat(200)
  await selectZip(page, await zip([['long-type.gpx', route('Long type', ['0', '10'], type)]]))
  await expectLoaded(page, 1)
  const label = page.locator('.type-label')
  await expect(label.locator('option:checked')).toHaveText(type)
  await expect(label).toHaveAttribute('title', type)
  await label.focus()
  await expect(label.locator('option:checked')).toHaveText(type)
  expect(await label.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThanOrEqual(180)
  expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
