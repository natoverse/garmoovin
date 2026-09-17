import { expect, test, type Page } from './test'
import { expectActivityNames, expectLoaded, gpx, selectZip, zip } from './fixtures'

declare global {
  interface Window {
    similarityProbe: {
      parses: number
      renders: number
      holdTimers: boolean
      timers: (() => void)[]
      failDigest: boolean
    }
  }
}

const degrees = 180 / (Math.PI * 6_371_000)
function route(name: string, offset = 0, type = 'hiking', day = 1) {
  return gpx(`<trk><name>${name}</name><type>${type}</type><trkseg>
    <trkpt lon="0" lat="${offset * degrees}">${day ? `<time>2025-01-${String(day).padStart(2, '0')}T00:00:00Z</time>` : ''}</trkpt>
    <trkpt lon="${1000 * degrees}" lat="${offset * degrees}"/>
  </trkseg></trk>`)
}

const files: [string, string][] = [
  ['garmin-1.gpx', route('Green A', 0, 'hiking', 4)],
  ['garmin-2.gpx', route('Green B', 40, 'running', 3)],
  ['garmin-3.gpx', route('Green C', 80, 'hiking', 2)],
  ['garmin-4.gpx', route('Far away', 1000, 'cycling', 1)],
  ['empty.gpx', gpx('<trk><name>No geometry</name></trk>')],
]
const grouping = (page: Page) => page.getByRole('checkbox', { name: 'Group similar routes' })
const tolerance = (page: Page) => page.getByRole('slider', { name: /Route tolerance/ })
const search = (page: Page) => page.getByRole('searchbox')

async function setup(page: Page, entries = files) {
  await page.goto('./')
  await selectZip(page, await zip(entries))
  await expectLoaded(page, entries.length)
}

async function expectGroups(page: Page, expected: string[][]) {
  await expect(page.locator('.similarity-count')).not.toContainText('Analysis pending')
  await expect.poll(() => page.locator('tbody tr').evaluateAll((rows) => {
    const groups = new Map<string, string[]>()
    for (const row of rows) {
      const key = row.getAttribute('data-route-group')!
      const names = groups.get(key) ?? []
      names.push(row.querySelector<HTMLInputElement>('.activity-name')!.value)
      groups.set(key, names)
    }
    return [...groups.values()]
  })).toEqual(expected)
}

async function setTolerance(page: Page, value: number) {
  await tolerance(page).evaluate((slider, next) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, String(next))
    slider.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
  await expect(tolerance(page)).toHaveAttribute('aria-valuetext', `${Number((value / 0.3048).toFixed(2))} feet`)
}

async function installProbe(page: Page) {
  await page.addInitScript(() => {
    window.similarityProbe = { parses: 0, renders: 0, holdTimers: false, timers: [], failDigest: false }
    const parse = DOMParser.prototype.parseFromString
    DOMParser.prototype.parseFromString = function (...args) {
      window.similarityProbe.parses++
      return parse.apply(this, args)
    }
    const render = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      window.similarityProbe.renders++
      render.apply(this, args)
    }
    const digest = crypto.subtle.digest.bind(crypto.subtle)
    crypto.subtle.digest = (...args) => window.similarityProbe.failDigest
      ? Promise.reject(new Error('Synthetic analysis resource failure.'))
      : digest(...args)
    const timer = window.setTimeout.bind(window)
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (window.similarityProbe.holdTimers && (!delay || delay <= 10) && typeof handler === 'function') {
        window.similarityProbe.timers.push(() => handler(...args))
        return 0
      }
      return timer(handler, delay, ...args)
    }) as typeof window.setTimeout
  })
}

async function releaseTimers(page: Page) {
  await page.evaluate(() => {
    window.similarityProbe.holdTimers = false
    const callbacks = window.similarityProbe.timers.splice(0)
    for (const callback of callbacks) callback()
  })
}

test('starts off, displays an accessible feet slider without changing matching, and never chains pair matches into a group', async ({ page }) => {
  await setup(page)
  await expect(grouping(page)).not.toBeChecked()
  await expect(tolerance(page)).toHaveValue('50')
  await expect(tolerance(page)).toHaveAttribute('min', '10')
  await expect(tolerance(page)).toHaveAttribute('max', '200')
  await expect(tolerance(page)).toHaveAttribute('step', '10')
  await expect(tolerance(page)).toHaveAttribute('aria-valuetext', '164.04 feet')
  await expect(page.locator('label[for="route-tolerance"]')).toHaveText('Route tolerance: 164.04 ft — lower is stricter')
  await grouping(page).focus()
  await page.keyboard.press('Space')
  await expectGroups(page, [['Green A', 'Green B'], ['Green C'], ['Far away'], ['No geometry']])
  await expect(page.locator('.results-count')).toHaveText('Showing 5 of 5 activities')
  await expect(page.locator('.similarity-count')).toHaveText('1 route bundle · 3 ungrouped activities')
  await expect(page.locator('.similarity-status')).toHaveText([
    'Ungrouped · no qualifying group',
    'Ungrouped · no qualifying group',
    'No usable route · missing or degenerate geometry',
  ])
  await expect(page.locator('.route-bundle .bundle-heading h3')).toHaveText('Green A')
  await expect(page.locator('.route-bundle .count')).toHaveText('2 activities')
  await expect(page.locator('.route-bundle a')).toHaveCount(2)
  await expect(page.locator('.route-bundle').getByRole('link', { name: /View on Garmin Connect for Green A/ })).toHaveAttribute('href', 'https://connect.garmin.com/modern/activity/1')
  await expect(page.locator('.route-bundle').getByRole('link', { name: /View on Garmin Connect for Green B/ })).toHaveAttribute('href', 'https://connect.garmin.com/modern/activity/2')
  await expect(page.locator('.ungrouped-activities').getByRole('link', { name: /View on Garmin Connect for Far away/ })).toHaveAttribute('href', 'https://connect.garmin.com/modern/activity/4')
  await expect(page.locator('.section-heading')).toContainText('Matching bundles first')
  await expect(page.locator('.similarity-panel')).toContainText('A looser tolerance can rearrange groups, not just merge them.')
  await tolerance(page).focus()
  await page.keyboard.press('ArrowLeft')
  await expect(tolerance(page)).toHaveValue('40')
  await expect(tolerance(page)).toHaveAttribute('aria-valuetext', '131.23 feet')
  await page.keyboard.press('Home')
  await expect(tolerance(page)).toHaveValue('10')
  await expect(tolerance(page)).toHaveAttribute('aria-valuetext', '32.81 feet')
  await expectGroups(page, files.map(([, contents]) => [/<name>(.*?)<\/name>/.exec(contents)![1]!]))
  await page.keyboard.press('End')
  await expect(tolerance(page)).toHaveValue('200')
  await expect(tolerance(page)).toHaveAttribute('aria-valuetext', '656.17 feet')
  await expectGroups(page, [['Green A', 'Green B', 'Green C'], ['Far away'], ['No geometry']])
  await grouping(page).uncheck()
  await expectActivityNames(page, ['Green A', 'Green B', 'Green C', 'Far away', 'No geometry'])
  await expect(page.locator('.section-heading')).toContainText('Newest first')
  await expect(page.locator('.similarity-status')).toHaveCount(0)
})

test('filters before grouping, replaces hidden representatives, and keeps archive-wide type tags', async ({ page }) => {
  await setup(page)
  await grouping(page).check()
  await expectGroups(page, [['Green A', 'Green B'], ['Green C'], ['Far away'], ['No geometry']])
  await page.getByRole('button', { name: 'Running', exact: true }).click()
  await expectGroups(page, [['Green A'], ['Green C'], ['Far away'], ['No geometry']])
  await expect(page.locator('.results-count')).toHaveText('Showing 4 of 5 activities')
  await page.getByRole('button', { name: 'Running', exact: true }).click()
  await search(page).fill('  gReEn b ')
  await expectGroups(page, [['Green B']])
  await expect(page.getByRole('group', { name: 'Activity types' }).getByRole('button')).toHaveText(['Cycling', 'Hiking', 'Running', 'Unknown'])
  await search(page).fill('')
  await page.getByRole('button', { name: 'Hiking', exact: true }).click()
  await expectGroups(page, [['Green B'], ['Far away'], ['No geometry']])
  await page.getByRole('button', { name: 'Select none', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'No activity types selected' })).toBeVisible()
  await expect(page.locator('.similarity-count')).toHaveText('0 route bundles · 0 ungrouped activities')
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await search(page).fill('.*')
  await expect(page.getByRole('heading', { name: 'No activities match your search' })).toBeVisible()
  await search(page).fill('')
  await expectGroups(page, [['Green A', 'Green B'], ['Green C'], ['Far away'], ['No geometry']])
})

test('expanded bundles precede newer singletons with clear membership and consecutive numbering', async ({ page }) => {
  await setup(page, [
    ['garmin-1.gpx', route('Newest singleton', 2000, 'hiking', 10)],
    ['garmin-2.gpx', route('Cedar morning', 0, 'hiking', 8)],
    ['garmin-3.gpx', route('Cedar evening', 4, 'running', 6)],
    ['garmin-4.gpx', route('Valley morning', 1000, 'hiking', 5)],
    ['garmin-5.gpx', route('Different imported title', 8, 'hiking', 4)],
    ['garmin-6.gpx', route('Another repeat', 12, 'hiking', 3)],
    ['garmin-7.gpx', route('Valley evening', 1004, 'hiking', 2)],
    ['missing.gpx', gpx('<trk><name>No geometry</name></trk>')],
  ])
  await grouping(page).check()
  await expectGroups(page, [
    ['Cedar morning', 'Cedar evening', 'Different imported title', 'Another repeat'],
    ['Valley morning', 'Valley evening'],
    ['Newest singleton'], ['No geometry'],
  ])
  const bundles = page.locator('.route-bundle')
  await expect(bundles).toHaveCount(2)
  await expect(bundles.locator('.bundle-label')).toHaveText(['Bundle 1 · Suggested match', 'Bundle 2 · Suggested match'])
  await expect(bundles.locator('.bundle-heading h3')).toHaveText(['Cedar morning', 'Valley morning'])
  await expect(bundles.locator('.count')).toHaveText(['4 activities', '2 activities'])
  await expect(page.getByRole('region', { name: 'Bundle 1 · Suggested match Cedar morning', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Bundle 2 · Suggested match Valley morning', exact: true })).toBeVisible()
  await expect(bundles.nth(0).locator('tbody tr')).toHaveCount(4)
  await expect(bundles.nth(1).locator('tbody tr')).toHaveCount(2)
  await expect(page.locator('.ungrouped-activities tbody tr')).toHaveCount(2)
  await expect(page.locator('.ungrouped-activities .activity-details .similarity-status')).toHaveText([
    'Ungrouped · no qualifying group', 'No usable route · missing or degenerate geometry',
  ])
  await expect(page.locator('.similarity-count')).toHaveText('2 route bundles · 2 ungrouped activities')
  await expect(page.locator('.results-count')).toHaveText('Showing 8 of 8 activities')
  await expect(page.getByRole('columnheader', { name: 'Route suggestion', exact: true })).toHaveCount(0)
  for (const input of await bundles.getByRole('textbox').all()) {
    await expect(input).toBeVisible()
    await expect(input).toBeEditable()
  }
  expect(await bundles.evaluateAll((elements) => {
    const first = elements[0]!.getBoundingClientRect()
    const second = elements[1]!.getBoundingClientRect()
    return second.top - first.bottom
  })).toBeGreaterThanOrEqual(24)
  await grouping(page).uncheck()
  await expect(bundles).toHaveCount(0)
  await expect(page.locator('.ungrouped-activities')).toHaveCount(0)
  await expect(page.getByRole('table')).toHaveCount(1)
  await expectActivityNames(page, [
    'Newest singleton', 'Cedar morning', 'Cedar evening', 'Valley morning',
    'Different imported title', 'Another repeat', 'Valley evening', 'No geometry',
  ])
})

test('bundle headings follow filtered representatives, not drafts, without interrupting in-place typing', async ({ page }) => {
  await setup(page, [
    ['garmin-1.gpx', route('Latest original', 0, 'running', 3)],
    ['garmin-2.gpx', route('Earlier original', 10, 'hiking', 2)],
    ['garmin-3.gpx', route('Oldest original', 20, 'hiking', 1)],
  ])
  await grouping(page).check()
  await expectGroups(page, [['Latest original', 'Earlier original', 'Oldest original']])
  await expect(page.locator('.ungrouped-activities')).toHaveCount(0)
  const title = page.getByRole('textbox', { name: 'Title for Latest original (garmin-1.gpx)', exact: true })
  await title.fill('')
  await title.pressSequentially('My edited title')
  await expect(title).toBeFocused()
  await expect(title).toHaveValue('My edited title')
  await expect(page.locator('.bundle-heading h3')).toHaveText('Latest original')
  await title.press('Enter')
  await expect(title).not.toBeFocused()
  await page.getByRole('button', { name: 'Running', exact: true }).click()
  await expectGroups(page, [['Earlier original', 'Oldest original']])
  await expect(page.locator('.route-bundle .bundle-heading h3')).toHaveText('Earlier original')
  await expect(page.locator('.route-bundle .bundle-label')).toHaveText('Bundle 1 · Suggested match')
  await expect(page.locator('.route-bundle .count')).toHaveText('2 activities')
  await page.getByRole('button', { name: 'Running', exact: true }).click()
  await expectGroups(page, [['My edited title', 'Earlier original', 'Oldest original']])
  await expect(title).toHaveValue('My edited title')
  await expect(page.locator('.bundle-heading h3')).toHaveText('Latest original')
  await search(page).fill('latest')
  await expectGroups(page, [['My edited title']])
  await expect(page.locator('.route-bundle')).toHaveCount(0)
  await expect(page.locator('.ungrouped-activities tbody tr')).toHaveCount(1)
  await search(page).fill('no matches')
  await expect(page.locator('.route-bundle, .ungrouped-activities')).toHaveCount(0)
})

for (const width of [320, 600, 601, 1440]) {
  test(`bundle headers fit and member previews remain equally sized and reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const longTitle = `Long imported route title ${'X'.repeat(180)}`
    await setup(page, [
      ['garmin-1.gpx', route(longTitle, 0, 'hiking', 3)],
      ['garmin-2.gpx', route('Earlier repeat', 5, 'hiking', 2)],
      ['garmin-3.gpx', route('Newer singleton', 2000, 'hiking', 4)],
    ])
    await grouping(page).check()
    await expectGroups(page, [[longTitle, 'Earlier repeat'], ['Newer singleton']])
    const bundle = page.locator('.route-bundle')
    const heading = bundle.locator('.bundle-heading')
    await expect(heading.getByRole('heading')).toHaveText(longTitle)
    expect(await heading.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await expect(bundle).toHaveCSS('border-top-width', '2px')
    await expect(bundle).toHaveCSS('border-top-color', 'rgb(94, 122, 112)')
    const size = width <= 600 ? [90, 60] : [120, 80]
    expect(await page.locator('.route-preview, .elevation-preview').evaluateAll((elements) =>
      elements.map((element) => {
        const { width, height } = element.getBoundingClientRect()
        return [width, height]
      }),
    )).toEqual(Array.from({ length: 6 }, () => size))
    const tableRegion = page.getByRole('region', { name: 'Scrollable activities in bundle 1', exact: true })
    await tableRegion.focus()
    await expect(tableRegion).toBeFocused()
    const before = await heading.boundingBox()
    await tableRegion.evaluate((element) => { element.scrollLeft = element.scrollWidth })
    expect(await heading.boundingBox()).toEqual(before)
    const title = bundle.getByRole('textbox').first()
    await title.focus()
    await expect(title).toBeFocused()
    await expect(title).toBeInViewport()
    const elevation = bundle.locator('.elevation-preview').first()
    await elevation.scrollIntoViewIfNeeded()
    await expect(elevation).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
}

test('grouped ordering uses representatives, source-path ties and unknown dates; filtering chooses a new representative', async ({ page }) => {
  await setup(page, [
    ['z.gpx', route('Repeat oldest', 0, 'running', 1)],
    ['tie/garmin-2.gpx', route('Tie B', 1000, 'hiking', 3)],
    ['tie/garmin-1.gpx', route('Tie A', 0, 'cycling', 3)],
    ['unknown.gpx', route('Unknown date', 1000, 'running', 0)],
    ['middle.gpx', route('Middle', 2000, 'hiking', 2)],
  ])
  await grouping(page).check()
  await expectGroups(page, [['Tie A', 'Repeat oldest'], ['Tie B', 'Unknown date'], ['Middle']])
  await page.getByRole('button', { name: 'Cycling', exact: true }).click()
  await expectGroups(page, [['Tie B', 'Unknown date'], ['Middle'], ['Repeat oldest']])
  await grouping(page).uncheck()
  await expectActivityNames(page, ['Tie B', 'Middle', 'Repeat oldest', 'Unknown date'])
})

test('drafts survive regrouping under original-title search and hidden drafts export exactly once', async ({ page }) => {
  await setup(page)
  await search(page).fill('green')
  const aTitle = page.getByRole('textbox', { name: 'Title for Green A (garmin-1.gpx)', exact: true })
  await aTitle.fill('First proposed name')
  await page.getByRole('textbox', { name: 'Title for Green C (garmin-3.gpx)', exact: true }).fill('Hidden proposed name')
  await grouping(page).check()
  await expectGroups(page, [['First proposed name', 'Green B'], ['Hidden proposed name']])
  await setTolerance(page, 100)
  await expectGroups(page, [['First proposed name', 'Green B', 'Hidden proposed name']])
  await expect(aTitle).toHaveValue('First proposed name')
  await search(page).fill('green a')
  await expectGroups(page, [['First proposed name']])
  await expect(page.getByRole('button', { name: 'Save JSON (2)' })).toBeEnabled()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save JSON (2)' }).click()
  const stream = await (await downloading).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  expect(JSON.parse(Buffer.concat(chunks).toString()).changes).toEqual([
    { sourceFile: 'garmin-1.gpx', originalTitle: 'Green A', newTitle: 'First proposed name', garminActivityId: '1', recordedStartTime: '2025-01-04T00:00:00.000Z', activityType: 'Hiking' },
    { sourceFile: 'garmin-3.gpx', originalTitle: 'Green C', newTitle: 'Hidden proposed name', garminActivityId: '3', recordedStartTime: '2025-01-02T00:00:00.000Z', activityType: 'Hiking' },
  ])
  await search(page).fill('')
  await grouping(page).uncheck()
  await expect(aTitle).toHaveValue('First proposed name')
})

test('activity cache hits, clearing, and rendering/storage failures preserve matching without network', async ({ page }) => {
  await installProbe(page)
  const entries = files.slice(0, 2)
  const archive = await zip(entries)
  await setup(page, entries)
  await page.reload()
  const requests: string[] = []
  page.on('request', (request) => { if (/^https?:/.test(request.url())) requests.push(request.url()) })
  await selectZip(page, archive)
  await expectLoaded(page, 2)
  await expect.poll(() => page.evaluate(() => window.similarityProbe.renders)).toBe(0)
  await grouping(page).check()
  await expectGroups(page, [['Green A', 'Green B']])
  const before = await page.evaluate(() => ({ parses: window.similarityProbe.parses, renders: window.similarityProbe.renders }))
  await page.getByRole('button', { name: 'Clear activity cache' }).click()
  await expect(page.locator('.cache-notice')).toContainText('Activity cache cleared')
  for (const value of [20, 100, 10, 50]) await setTolerance(page, value)
  await search(page).fill('a')
  await search(page).fill('')
  await expectGroups(page, [['Green A', 'Green B']])
  expect(await page.evaluate(() => ({ parses: window.similarityProbe.parses, renders: window.similarityProbe.renders }))).toEqual(before)
  await page.evaluate(() => {
    IDBDatabase.prototype.transaction = () => { throw new Error('Synthetic storage failure') }
    HTMLCanvasElement.prototype.toBlob = (callback) => callback(null)
  })
  await selectZip(page, archive, 'uncached.zip')
  await expectLoaded(page, 2)
  await grouping(page).check()
  await expectGroups(page, [['Green A', 'Green B']])
  await expect(page.locator('.route-preview')).toHaveText(['Thumbnail unavailable', 'Thumbnail unavailable'])
  expect(requests).toEqual([])
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0)
  expect(await page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name))).toEqual(['groomin-activities'])
})

test('superseded group calculations cannot publish stale memberships after slider, filter or archive changes', async ({ page }) => {
  await installProbe(page)
  await setup(page)
  await page.evaluate(() => { window.similarityProbe.holdTimers = true })
  await grouping(page).check()
  await expect(page.locator('.similarity-count')).toContainText('Analysis pending')
  await expect.poll(() => page.evaluate(() => window.similarityProbe.timers.length)).toBeGreaterThan(0)
  await setTolerance(page, 200)
  await search(page).fill('green c')
  await setTolerance(page, 10)
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expectActivityNames(page, ['Green C'])
  await releaseTimers(page)
  await expectGroups(page, [['Green C']])
  await search(page).fill('')
  await page.evaluate(() => { window.similarityProbe.holdTimers = true })
  await setTolerance(page, 100)
  await expect(page.locator('.similarity-count')).toContainText('Analysis pending')
  await selectZip(page, await zip([['new.gpx', route('Replacement only', 2000)]]), 'new.zip')
  await expect(page.getByRole('textbox', { name: /^Title for Green/ })).toHaveCount(0)
  await releaseTimers(page)
  await expectLoaded(page, 1)
  await expect(grouping(page)).not.toBeChecked()
  await expect(tolerance(page)).toHaveValue('50')
  await expect(search(page)).toBeEmpty()
  await grouping(page).check()
  await expectGroups(page, [['Replacement only']])
})

test('several-hundred-route import stays replaceable with unfinished analysis and preserves draft safeguards', async ({ page }) => {
  await installProbe(page)
  await page.goto('./')
  const archive = await zip(Array.from({ length: 360 }, (_, index) => [
    `${index}.gpx`, route(`Route ${index}`, index * 20),
  ]))
  await page.evaluate(() => { window.similarityProbe.holdTimers = true })
  await selectZip(page, archive)
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(page.getByText('Preparing route geometry: 1 pending.')).toBeVisible()
  await grouping(page).check()
  await expect(page.locator('.similarity-status')).toHaveText('Analysis pending')
  await search(page).fill('route 0')
  await setTolerance(page, 120)
  const draft = page.getByRole('textbox', { name: 'Title for Route 0 (0.gpx)', exact: true })
  await draft.fill('Keep draft')
  page.once('dialog', (dialog) => dialog.dismiss())
  const replacement = await zip([['fresh.gpx', route('Fresh')]])
  await selectZip(page, replacement)
  await expect(draft).toHaveValue('Keep draft')
  await expect(tolerance(page)).toHaveValue('120')
  page.once('dialog', (dialog) => dialog.accept())
  await selectZip(page, replacement)
  await releaseTimers(page)
  await expectLoaded(page, 1)
  await expectActivityNames(page, ['Fresh'])
  await expect(page.getByRole('textbox')).toHaveValue('Fresh')
  await expect(grouping(page)).not.toBeChecked()
  await expect(tolerance(page)).toHaveValue('50')
})

test('analysis failures retain activities and usable previews with an explanation', async ({ page }) => {
  await installProbe(page)
  await page.goto('./')
  await page.evaluate(() => { window.similarityProbe.failDigest = true })
  await selectZip(page, await zip([['error.gpx', route('Analysis failure')], ['missing.gpx', gpx()]]))
  await expectLoaded(page, 2)
  await grouping(page).check()
  await expectGroups(page, [['Analysis failure'], ['missing.gpx']])
  await expect(page.locator('.similarity-status').first()).toContainText('Analysis unavailable')
  await expect(page.locator('.similarity-status').first()).toContainText('Synthetic analysis resource failure')
  await expect(page.getByRole('img', { name: 'Route preview for Analysis failure' })).toHaveJSProperty('naturalWidth', 240)
  await expect(page.locator('.similarity-status').last()).toContainText('No usable route')
})

test('over-limit routes remain visible without silently truncating their geometry', async ({ page }) => {
  await page.goto('./')
  await selectZip(page, await zip([
    ['long.gpx', gpx('<trk><name>Beyond analysis limit</name><trkseg><trkpt lon="0" lat="0"/><trkpt lon="5" lat="0"/></trkseg></trk>')],
    ['normal.gpx', route('Usable short route')],
  ]))
  await expectLoaded(page, 2)
  await grouping(page).check()
  await expectGroups(page, [['Usable short route'], ['Beyond analysis limit']])
  await expect(page.locator('.similarity-status').last()).toContainText('Analysis unavailable')
  await expect(page.locator('.similarity-status').last()).toContainText('not truncated')
  await expect(page.getByRole('img', { name: 'Route preview for Beyond analysis limit' })).toHaveJSProperty('naturalWidth', 240)
  await expect(page.getByRole('textbox', { name: 'Title for Beyond analysis limit (long.gpx)' })).toBeEnabled()
})

test('similarity controls fit narrow screens and remain available with empty filters', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await setup(page)
  await grouping(page).check()
  await search(page).fill('no matches')
  await expect(tolerance(page)).toBeVisible()
  await expect(grouping(page)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
