import { expect, test, type Page } from '@playwright/test'
import { expectLoaded, gpx, selectZip, zip } from './fixtures'

declare global {
  interface Window {
    filterProbe: {
      parses: number
      renders: number
      release: (() => void) | null
    }
  }
}

function activity(name: string, type: string, day = 1) {
  return gpx(`<trk><name>${name}</name><type>${type}</type><trkseg>
    <trkpt lat="0" lon="0"><time>2025-01-${String(day).padStart(2, '0')}T00:00:00Z</time></trkpt>
    <trkpt lat="1" lon="1"/>
  </trkseg></trk>`)
}

const sampleFiles: [string, string][] = [
  ['a.gpx', activity('Green Mountain', 'hiking', 3)],
  ['b.gpx', activity('Green Mountain Loop', 'running', 2)],
  ['c.gpx', activity('Riverside Ride', 'cycling', 1)],
  ['d.gpx', gpx('<trk><name>Meadow Stroll</name></trk>')],
  ['e.gpx', activity('Greenway Outing', 'hiking', 4)],
  ['f.gpx', activity('Literal [loop].*', 'hiking', 5)],
]

const search = (page: Page) => page.getByRole('searchbox', { name: 'Search activity names' })
const tags = (page: Page) => page.getByRole('group', { name: 'Activity types' }).getByRole('button')
const typeTag = (page: Page, type: string) => tags(page).filter({ hasText: new RegExp(`^${type}$`) })

async function setup(page: Page, files = sampleFiles) {
  await page.goto('./')
  await selectZip(page, await zip(files))
  await expectLoaded(page, files.length)
}

async function expectCount(page: Page, visible: number, total = sampleFiles.length) {
  await expect(page.locator('.results-count')).toHaveText(`Showing ${visible} of ${total} activities`)
  await expect(page.locator('tbody tr')).toHaveCount(visible)
}

async function installProbe(page: Page, holdFirstRender = false) {
  await page.addInitScript((hold) => {
    window.filterProbe = { parses: 0, renders: 0, release: null }
    const parse = DOMParser.prototype.parseFromString
    DOMParser.prototype.parseFromString = function (...args) {
      window.filterProbe.parses++
      return parse.apply(this, args)
    }
    const render = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      window.filterProbe.renders++
      if (hold) {
        hold = false
        window.filterProbe.release = () => render.apply(this, args)
      } else {
        render.apply(this, args)
      }
    }
  }, holdFirstRender)
}

test('shows all distinct activity types selected, with all/none buttons and no All tag', async ({ page }) => {
  await setup(page)
  await expect(tags(page)).toHaveText(['Cycling', 'Hiking', 'Running', 'Unknown'])
  for (const tag of await tags(page).all()) await expect(tag).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Select all', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Select none', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveCount(0)
  await expect(search(page)).toBeEmpty()
  await expectCount(page, 6)
  await expect(page.locator('.activity-name')).toHaveText([
    'Literal [loop].*', 'Greenway Outing', 'Green Mountain', 'Green Mountain Loop', 'Riverside Ride', 'Meadow Stroll',
  ])
})

test('independently toggles multiple types and supports keyboard activation', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: 'Select none', exact: true }).click()
  await expectCount(page, 0)
  await expect(page.getByRole('heading', { name: 'No activity types selected' })).toBeVisible()
  await typeTag(page, 'Hiking').focus()
  await page.keyboard.press('Space')
  await expect(typeTag(page, 'Hiking')).toHaveAttribute('aria-pressed', 'true')
  await expectCount(page, 3)
  await typeTag(page, 'Running').click()
  await expectCount(page, 4)
  await typeTag(page, 'Hiking').focus()
  await page.keyboard.press('Enter')
  await expect(typeTag(page, 'Hiking')).toHaveAttribute('aria-pressed', 'false')
  await expectCount(page, 1)
  await expect(page.locator('.activity-name')).toHaveText(['Green Mountain Loop'])
  await typeTag(page, 'Unknown').click()
  await expectCount(page, 2)
  await expect(page.locator('.activity-name')).toHaveText(['Green Mountain Loop', 'Meadow Stroll'])
})

test('matches case-insensitive literal substrings, including partial words and punctuation', async ({ page }) => {
  await setup(page)
  const cases: [string, number][] = [
    ['green', 3], ['GREEN', 3], ['gree', 3], ['  green  ', 3],
    ['mount', 2], ['green mountain', 2], ['green loop', 0],
    ['green  mountain', 0], ['.*', 1], ['[loop]', 1],
    ['hiking', 0], ['a.gpx', 0], ['   ', 6], ['', 6],
  ]
  for (const [query, count] of cases) {
    await search(page).fill(query)
    await expectCount(page, count)
  }
})

test('combines type and name filters while retaining every tag and the full loaded count', async ({ page }) => {
  await setup(page)
  await search(page).fill('green')
  await typeTag(page, 'Hiking').click()
  await expectCount(page, 1)
  await expect(page.locator('.activity-name')).toHaveText(['Green Mountain Loop'])
  await typeTag(page, 'Running').click()
  await expectCount(page, 0)
  await expect(page.getByRole('heading', { name: 'No activities match your search' })).toBeVisible()
  await expect(tags(page)).toHaveText(['Cycling', 'Hiking', 'Running', 'Unknown'])
  await expect(typeTag(page, 'Cycling')).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Select none', exact: true }).click()
  await expect(search(page)).toHaveValue('green')
  await expect(page.getByRole('heading', { name: 'No activity types selected' })).toBeVisible()
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await expect(search(page)).toHaveValue('green')
  await expectCount(page, 3)
  await typeTag(page, 'Hiking').click()
  await search(page).fill('')
  await expectCount(page, 3)
  await expect(page.locator('.activity-name')).toHaveText(['Green Mountain Loop', 'Riverside Ride', 'Meadow Stroll'])
})

test('search uses the existing metadata-name and filename fallbacks', async ({ page }) => {
  await setup(page, [
    ['route.gpx', gpx('<metadata><name>Green metadata</name></metadata>')],
    ['nested/green-filename.gpx', gpx()],
  ])
  await search(page).fill('GREEN')
  await expectCount(page, 2, 2)
  await search(page).fill('filename')
  await expectCount(page, 1, 2)
  await expect(page.locator('.activity-name')).toHaveText(['green-filename.gpx'])
})

test('replacement imports reset filters, while cancelling file selection preserves them', async ({ page }) => {
  await setup(page)
  await search(page).fill('green')
  await page.getByRole('button', { name: 'Select none', exact: true }).click()
  await typeTag(page, 'Hiking').click()
  await page.getByLabel('Open GPX ZIP').setInputFiles([])
  await expect(search(page)).toHaveValue('green')
  await expectCount(page, 2)
  await selectZip(page, await zip([['new.gpx', activity('New activity', 'walking')]]), 'replacement.zip')
  await expectLoaded(page, 1)
  await expect(search(page)).toBeEmpty()
  await expect(tags(page)).toHaveText(['Walking'])
  await expect(typeTag(page, 'Walking')).toHaveAttribute('aria-pressed', 'true')
  await expectCount(page, 1, 1)
  await expect(page.locator('.activity-name')).toHaveText(['New activity'])
})

test('filtering reuses loaded metadata and images, even after their disk cache is cleared', async ({ page }) => {
  await installProbe(page)
  await setup(page)
  const before = await page.evaluate(() => ({ parses: window.filterProbe.parses, renders: window.filterProbe.renders }))
  const network: string[] = []
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) network.push(request.url())
  })
  await page.getByRole('button', { name: 'Clear thumbnail cache' }).click()
  await expect(page.locator('.cache-notice')).toContainText('Thumbnail cache cleared.')
  await page.getByRole('button', { name: 'Select none', exact: true }).click()
  await search(page).fill('mount')
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await expectCount(page, 2)
  await expect(page.getByRole('img', { name: 'Route preview for Green Mountain', exact: true })).toHaveJSProperty('naturalWidth', 240)
  await search(page).fill('')
  await expectCount(page, 6)
  expect(await page.evaluate(() => ({ parses: window.filterProbe.parses, renders: window.filterProbe.renders }))).toEqual(before)
  expect(network).toEqual([])
})

for (const selectNewTypes of [false, true]) {
  test(`progressive imports keep newly discovered types ${selectNewTypes ? 'selected' : 'deselected'} after an all/none choice`, async ({ page }) => {
    await installProbe(page, true)
    await page.goto('./')
    await selectZip(page, await zip([
      ['first.gpx', activity('First route', 'hiking')],
      ['second.gpx', activity('Second route', 'cycling')],
    ]))
    await expect.poll(() => page.evaluate(() => window.filterProbe.release !== null)).toBe(true)
    await expect(tags(page)).toHaveText(['Hiking'])
    await page.getByRole('button', { name: 'Select none', exact: true }).click()
    if (selectNewTypes) await page.getByRole('button', { name: 'Select all', exact: true }).click()
    await page.evaluate(() => window.filterProbe.release?.())
    await expect(page.getByRole('status')).toContainText('Import complete. 2 activities loaded.')
    await expect(typeTag(page, 'Cycling')).toHaveAttribute('aria-pressed', String(selectNewTypes))
    await expect(typeTag(page, 'Hiking')).toHaveAttribute('aria-pressed', String(selectNewTypes))
    await expectCount(page, selectNewTypes ? 2 : 0, 2)
  })
}

test('search and tags fit narrow screens without hiding controls in the no-results state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await setup(page)
  await search(page).fill('not a matching activity')
  await expectCount(page, 0)
  await expect(search(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Select all', exact: true })).toBeVisible()
  await expect(tags(page)).toHaveCount(4)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
