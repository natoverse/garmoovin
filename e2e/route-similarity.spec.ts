import { expect, test, type Page } from './test'
import { expectLoaded, gpx, selectZip, zip } from './fixtures'

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
      names.push(row.querySelector('.activity-name')!.textContent!)
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
  await expect(tolerance(page)).toHaveAttribute('aria-valuetext', `${value} metres`)
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

test('starts off, uses an accessible metre slider, and never chains pair matches into a group', async ({ page }) => {
  await setup(page)
  await expect(grouping(page)).not.toBeChecked()
  await expect(tolerance(page)).toHaveValue('50')
  await expect(tolerance(page)).toHaveAttribute('min', '10')
  await expect(tolerance(page)).toHaveAttribute('max', '200')
  await expect(tolerance(page)).toHaveAttribute('step', '10')
  await grouping(page).focus()
  await page.keyboard.press('Space')
  await expectGroups(page, [['Green A', 'Green B'], ['Green C'], ['Far away'], ['No geometry']])
  await expect(page.locator('.results-count')).toHaveText('Showing 5 of 5 activities')
  await expect(page.locator('.similarity-count')).toHaveText('1 similar route group · 3 ungrouped activities')
  await expect(page.locator('.similarity-status')).toHaveText([
    'Suggestion 1 · 2 activities · Representative',
    'Suggestion 1 · 2 activities · Representative: Green A',
    'Ungrouped · no qualifying group',
    'Ungrouped · no qualifying group',
    'No usable route · missing or degenerate geometry',
  ])
  await expect(page.locator('.section-heading')).toContainText('Grouped by newest representative')
  await expect(page.locator('.similarity-panel')).toContainText('A looser tolerance can rearrange groups, not just merge them.')
  await tolerance(page).focus()
  await page.keyboard.press('ArrowLeft')
  await expect(tolerance(page)).toHaveValue('40')
  await page.keyboard.press('Home')
  await expect(tolerance(page)).toHaveValue('10')
  await expectGroups(page, files.map(([, contents]) => [/<name>(.*?)<\/name>/.exec(contents)![1]!]))
  await page.keyboard.press('End')
  await expect(tolerance(page)).toHaveValue('200')
  await expectGroups(page, [['Green A', 'Green B', 'Green C'], ['Far away'], ['No geometry']])
  await grouping(page).uncheck()
  await expect(page.locator('.activity-name')).toHaveText(['Green A', 'Green B', 'Green C', 'Far away', 'No geometry'])
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
  await expect(page.locator('.similarity-count')).toHaveText('0 similar route groups · 0 ungrouped activities')
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await search(page).fill('.*')
  await expect(page.getByRole('heading', { name: 'No activities match your search' })).toBeVisible()
  await search(page).fill('')
  await expectGroups(page, [['Green A', 'Green B'], ['Green C'], ['Far away'], ['No geometry']])
})

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
  await expect(page.locator('.activity-name')).toHaveText(['Tie B', 'Middle', 'Repeat oldest', 'Unknown date'])
})

test('drafts survive regrouping under original-title search and hidden drafts export exactly once', async ({ page }) => {
  await setup(page)
  await search(page).fill('green')
  const aTitle = page.getByRole('textbox', { name: 'New title for Green A (garmin-1.gpx)', exact: true })
  await aTitle.fill('First proposed name')
  await page.getByRole('textbox', { name: 'New title for Green C (garmin-3.gpx)', exact: true }).fill('Hidden proposed name')
  await grouping(page).check()
  await expectGroups(page, [['Green A', 'Green B'], ['Green C']])
  await setTolerance(page, 100)
  await expectGroups(page, [['Green A', 'Green B', 'Green C']])
  await expect(aTitle).toHaveValue('First proposed name')
  await search(page).fill('green a')
  await expectGroups(page, [['Green A']])
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

test('thumbnail cache hits, clearing, and rendering/storage failures preserve matching without network or new persistence', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Clear thumbnail cache' }).click()
  await expect(page.locator('.cache-notice')).toContainText('Thumbnail cache cleared')
  for (const value of [20, 100, 10, 50]) await setTolerance(page, value)
  await search(page).fill('a')
  await search(page).fill('')
  await expectGroups(page, [['Green A', 'Green B']])
  expect(await page.evaluate(() => ({ parses: window.similarityProbe.parses, renders: window.similarityProbe.renders }))).toEqual(before)
  await page.evaluate(() => {
    indexedDB.open = () => { throw new Error('Synthetic storage failure') }
    HTMLCanvasElement.prototype.toBlob = (callback) => callback(null)
  })
  await selectZip(page, archive, 'uncached.zip')
  await expectLoaded(page, 2)
  await grouping(page).check()
  await expectGroups(page, [['Green A', 'Green B']])
  await expect(page.locator('.route-preview')).toHaveText(['Thumbnail unavailable', 'Thumbnail unavailable'])
  expect(requests).toEqual([])
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0)
  expect(await page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name))).toEqual(['groomin-thumbnails'])
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
  await expect(page.locator('.activity-name')).toHaveText(['Green C'])
  await releaseTimers(page)
  await expectGroups(page, [['Green C']])
  await search(page).fill('')
  await page.evaluate(() => { window.similarityProbe.holdTimers = true })
  await setTolerance(page, 100)
  await expect(page.locator('.similarity-count')).toContainText('Analysis pending')
  await selectZip(page, await zip([['new.gpx', route('Replacement only', 2000)]]), 'new.zip')
  await expect(page.locator('.activity-name').filter({ hasText: 'Green' })).toHaveCount(0)
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
  const draft = page.getByRole('textbox', { name: 'New title for Route 0 (0.gpx)', exact: true })
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
  await expect(page.locator('.activity-name')).toHaveText(['Fresh'])
  await expect(page.getByRole('textbox')).toBeEmpty()
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
  await expect(page.getByRole('textbox', { name: 'New title for Beyond analysis limit (long.gpx)' })).toBeEnabled()
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
