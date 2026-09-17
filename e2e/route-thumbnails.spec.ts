import { expect, test, type Page } from '@playwright/test'
import { digest, projectRoute, routeKey, THUMBNAIL_SETTINGS, type Route } from '../src/route'
import { expectLoaded, gpx, selectZip, zip } from './fixtures'

declare global {
  interface Window {
    thumbnailProbe: {
      renders: number
      delay: number
      failures: number
      paths: number
      lines: number
      urls: Set<string>
    }
  }
}

const triangle: Route = [[[0, 0], [1, 0], [1, 1], [0, 0]]]
const line: Route = [[[0, 0], [0, 1]]]
const points = (route: Route) => route.map((segment) =>
  `<trkseg>${segment.map(([lon, lat]) => `<trkpt lat="${lat}" lon="${lon}"/>`).join('')}</trkseg>`,
).join('')
const routeGpx = (route = triangle, name = 'Synthetic route') =>
  gpx(`<trk><name>${name}</name><type>hiking</type>${points(route)}</trk>`)

async function setup(page: Page, options = { delay: 0, failures: 0 }) {
  await page.addInitScript(({ delay, failures }) => {
    window.thumbnailProbe = { renders: 0, delay, failures, paths: 0, lines: 0, urls: new Set() }
    const toBlob = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      window.thumbnailProbe.renders++
      if (window.thumbnailProbe.failures-- > 0) {
        args[0](null)
      } else if (window.thumbnailProbe.delay > 0) {
        setTimeout(() => toBlob.apply(this, args), window.thumbnailProbe.delay)
      } else {
        toBlob.apply(this, args)
      }
    }
    const moveTo = CanvasRenderingContext2D.prototype.moveTo
    CanvasRenderingContext2D.prototype.moveTo = function (...args) {
      window.thumbnailProbe.paths++
      moveTo.apply(this, args)
    }
    const lineTo = CanvasRenderingContext2D.prototype.lineTo
    CanvasRenderingContext2D.prototype.lineTo = function (...args) {
      window.thumbnailProbe.lines++
      lineTo.apply(this, args)
    }
    const create = URL.createObjectURL
    URL.createObjectURL = (blob) => {
      const url = create(blob)
      window.thumbnailProbe.urls.add(url)
      return url
    }
    const revoke = URL.revokeObjectURL
    URL.revokeObjectURL = (url) => {
      window.thumbnailProbe.urls.delete(url)
      revoke(url)
    }
  }, options)
  await page.goto('/')
}

async function cachedKeys(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('garmin-view-thumbnails', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<string[]>((resolve, reject) => {
        const tx = db.transaction('images', 'readonly')
        const request = tx.objectStore('images').getAllKeys()
        tx.oncomplete = () => resolve(request.result.map(String))
        tx.onabort = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  })
}

async function expectImage(page: Page, name = 'Synthetic route') {
  await expect(page.getByRole('img', { name: `Route preview for ${name}`, exact: true })).toHaveJSProperty('naturalWidth', 240)
}

test('projection is north-up, proportional, padded, and handles dateline and degenerate routes', async () => {
  const route = projectRoute([[[0, 60], [1, 60], [1, 61], [0, 61], [0, 60]]])[0]!
  const [southwest, southeast, northeast] = route
  expect(southwest![0]).toBeLessThan(southeast![0])
  expect(southwest![1]).toBeGreaterThan(northeast![1])
  const ratio = (southeast![0] - southwest![0]) / (southeast![1] - northeast![1])
  expect(ratio).toBeCloseTo(Math.cos(60.5 * Math.PI / 180), 6)
  for (const [x, y] of route) {
    expect(x).toBeGreaterThanOrEqual(THUMBNAIL_SETTINGS.padding)
    expect(x).toBeLessThanOrEqual(THUMBNAIL_SETTINGS.width - THUMBNAIL_SETTINGS.padding)
    expect(y).toBeGreaterThanOrEqual(THUMBNAIL_SETTINGS.padding)
    expect(y).toBeLessThanOrEqual(THUMBNAIL_SETTINGS.height - THUMBNAIL_SETTINGS.padding)
  }
  const dateline = projectRoute([[[179, 10], [-179, 10], [-179, 12]]])[0]!
  const datelineRatio = (dateline[1]![0] - dateline[0]![0]) / (dateline[1]![1] - dateline[2]![1])
  expect(datelineRatio).toBeCloseTo(Math.cos(11 * Math.PI / 180), 6)
  expect(projectRoute([])).toEqual([])
  expect(projectRoute([[[0, 0], [0, 0]]])).toEqual([])
  expect(projectRoute(line)[0]!.every(([x]) => x === 120)).toBe(true)
})

test('cache fingerprint includes both geometry and every rendering setting', async () => {
  const expected = await digest(new TextEncoder().encode(JSON.stringify({ settings: THUMBNAIL_SETTINGS, route: triangle })).buffer)
  const previousVersion = await digest(new TextEncoder().encode(JSON.stringify({
    settings: { ...THUMBNAIL_SETTINGS, version: 0 }, route: triangle,
  })).buffer)
  expect(await routeKey(triangle)).toEqual(expected)
  expect(expected).not.toEqual(previousVersion)
  expect(await routeKey(line)).not.toEqual(expected)
  expect(await routeKey([[[0, 0], [1, 0]], [[1, 1], [0, 0]]])).not.toEqual(expected)
})

test('draws a route without network requests and only persists the derived image', async ({ page }) => {
  await setup(page)
  const network: string[] = []
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) network.push(request.url())
  })
  await selectZip(page, await zip([['route.gpx', routeGpx()]]))
  await expectLoaded(page, 1)
  await expectImage(page)
  expect(await page.evaluate(() => window.thumbnailProbe.renders)).toBe(1)
  expect(network).toEqual([])
  const keys = await cachedKeys(page)
  expect(keys).toEqual([await routeKey(triangle)])
  const fields = await page.evaluate(async (key) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('garmin-view-thumbnails', 1)
      request.onsuccess = () => resolve(request.result)
    })
    try {
      return await new Promise<string[]>((resolve) => {
        const request = db.transaction('images').objectStore('images').get(key!)
        request.onsuccess = () => resolve(Object.keys(request.result).sort())
      })
    } finally { db.close() }
  }, keys[0])
  expect(fields).toEqual(['checksum', 'image', 'key'])
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0)
})

test('keeps tracks, segments, and invalid-coordinate gaps disconnected', async ({ page }) => {
  await setup(page)
  const geometry = `<trk><name>Separate segments</name>
    <trkseg><trkpt lat="0" lon="0"/><trkpt lat="1" lon="1"/>
    <trkpt lat="" lon="2"/>
    <trkpt lat="2" lon="2"/><trkpt lat="3" lon="3"/></trkseg>
    <trkseg><trkpt lat="4" lon="4"/><trkpt lat="5" lon="5"/></trkseg></trk>
    <trk><trkseg><trkpt lat="6" lon="6"/><trkpt lat="7" lon="7"/></trkseg></trk>`
  await selectZip(page, await zip([['segments.gpx', gpx(geometry)]]))
  await expectLoaded(page, 1)
  await expectImage(page, 'Separate segments')
  expect(await page.evaluate(() => ({ paths: window.thumbnailProbe.paths, lines: window.thumbnailProbe.lines }))).toEqual({ paths: 4, lines: 4 })
})

test('missing, invalid, isolated, or stationary geometry yields No route, not an import error', async ({ page }) => {
  await setup(page)
  const cases = [
    '',
    '<trkseg><trkpt lat="0" lon="0"/></trkseg>',
    '<trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="0"/></trkseg>',
    '<trkseg><trkpt lat="0" lon="0"/><trkpt lat="91" lon="0"/><trkpt lat="1" lon="1"/></trkseg>',
    '<trkseg><trkpt lat="0" lon="0"/><trkpt lat="1" lon="181"/></trkseg>',
    '<trkseg><trkpt lat="NaN" lon="0"/><trkpt lat="1" lon="1"/></trkseg>',
    '<trkseg><trkpt lat="0x10" lon="0"/><trkpt lat="1" lon="1"/></trkseg>',
    '<trkseg><trkpt lon="0"/><trkpt lat="1" lon="1"/></trkseg>',
    '<trkseg><trkpt lat="0" lon="0"/></trkseg><trkseg><trkpt lat="1" lon="1"/></trkseg>',
  ]
  await selectZip(page, await zip(cases.map((body, i) => [`case-${i}.gpx`, gpx(`<trk><name>Case ${i}</name>${body}</trk>`)])))
  await expectLoaded(page, cases.length)
  await expect(page.locator('.route-preview')).toHaveText(cases.map(() => 'No route'))
  expect(await page.evaluate(() => window.thumbnailProbe.renders)).toBe(0)
})

test('reuses cached images after reload and does not retain the activity archive', async ({ page }) => {
  await setup(page)
  const archive = await zip([['route.gpx', routeGpx()]])
  await selectZip(page, archive)
  await expectLoaded(page, 1)
  await expectImage(page)
  await page.reload()
  await expect(page.locator('tbody tr')).toHaveCount(0)
  await selectZip(page, archive)
  await expectLoaded(page, 1)
  await expectImage(page)
  expect(await page.evaluate(() => window.thumbnailProbe.renders)).toBe(0)
})

test('reuses renamed routes but invalidates changed geometry under identical filenames', async ({ page }) => {
  await setup(page)
  await selectZip(page, await zip([['route.gpx', routeGpx()]]), 'first.zip')
  await expectLoaded(page, 1)
  await selectZip(page, await zip([['renamed.gpx', routeGpx(triangle, 'Renamed route')]]), 'renamed.zip')
  await expectLoaded(page, 1)
  await expectImage(page, 'Renamed route')
  expect(await page.evaluate(() => window.thumbnailProbe.renders)).toBe(1)
  await selectZip(page, await zip([['route.gpx', routeGpx(line)]]), 'first.zip')
  await expectLoaded(page, 1)
  await expectImage(page)
  expect(await page.evaluate(() => window.thumbnailProbe.renders)).toBe(2)
  expect((await cachedKeys(page)).length).toBe(2)
  expect(await page.evaluate(() => window.thumbnailProbe.urls.size)).toBe(1)
})

for (const corruption of ['checksum', 'broken-png', 'wrong-dimensions']) {
  test(`regenerates a cached image with ${corruption}`, async ({ page }) => {
    await setup(page)
    const archive = await zip([['route.gpx', routeGpx()]])
    await selectZip(page, archive)
    await expectLoaded(page, 1)
    const key = (await cachedKeys(page))[0]!
    await page.evaluate(async ({ key, corruption }) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open('garmin-view-thumbnails', 1)
        request.onsuccess = () => resolve(request.result)
      })
      try {
        const record = await new Promise<{ key: string; image: Blob; checksum: string }>((resolve) => {
          const request = db.transaction('images').objectStore('images').get(key)
          request.onsuccess = () => resolve(request.result)
        })
        if (corruption === 'broken-png') record.image = new Blob(['not a PNG'], { type: 'image/png' })
        if (corruption === 'wrong-dimensions') {
          const canvas = document.createElement('canvas')
          canvas.width = 10
          canvas.height = 10
          record.image = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!)))
        }
        record.checksum = corruption === 'checksum' ? 'invalid' : Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', await record.image.arrayBuffer())),
          (byte) => byte.toString(16).padStart(2, '0'),
        ).join('')
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('images', 'readwrite')
          tx.objectStore('images').put(record, key)
          tx.oncomplete = () => resolve()
          tx.onabort = () => reject(tx.error)
        })
      } finally { db.close() }
    }, { key, corruption })
    await page.reload()
    await selectZip(page, archive)
    await expectLoaded(page, 1)
    await expectImage(page)
    expect(await page.evaluate(() => window.thumbnailProbe.renders)).toBe(1)
    await expect(page.getByRole('alert')).toContainText('A cached thumbnail could not be read')
  })
}

test('keeps rendering when browser storage is unavailable and reports clear failures', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { get() { throw new DOMException('Storage access denied.', 'SecurityError') } })
  })
  await setup(page)
  await selectZip(page, await zip([['route.gpx', routeGpx()]]))
  await expectLoaded(page, 1)
  await expectImage(page)
  await expect(page.getByRole('alert')).toContainText('Thumbnail cache unavailable')
  await page.getByRole('button', { name: 'Clear thumbnail cache' }).click()
  await expect(page.getByRole('alert')).toContainText('Could not clear thumbnail cache')
  await expectImage(page)
})

for (const failure of ['quota', 'abort']) {
  test(`reports cache write ${failure} without losing the preview or metadata`, async ({ page }) => {
    await page.addInitScript((failure) => {
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (...args) {
        if (failure === 'quota') throw new DOMException('Storage quota exceeded.', 'QuotaExceededError')
        const request = put.apply(this, args)
        this.transaction.abort()
        return request
      }
    }, failure)
    await setup(page)
    await selectZip(page, await zip([['route.gpx', routeGpx()]]))
    await expectLoaded(page, 1)
    await expectImage(page)
    await expect(page.getByRole('alert')).toContainText('Thumbnail cache unavailable')
  })
}

test('distinguishes renderer failures from absent routes and retains every activity', async ({ page }) => {
  await setup(page, { delay: 0, failures: 1 })
  await selectZip(page, await zip([
    ['a.gpx', routeGpx(triangle, 'Failed image')],
    ['b.gpx', routeGpx([], 'No geometry')],
    ['c.gpx', routeGpx(line, 'Good image')],
  ]))
  await expectLoaded(page, 3)
  await expect(page.locator('.route-error')).toHaveText('Thumbnail unavailable')
  await expect(page.getByText('No route', { exact: true })).toBeVisible()
  await expectImage(page, 'Good image')
})

test('shows metadata while rendering and never attaches an old import thumbnail to a replacement', async ({ page }) => {
  await setup(page, { delay: 700, failures: 0 })
  await selectZip(page, await zip([['route.gpx', routeGpx(triangle, 'Old route')]]))
  await expect(page.locator('.activity-name')).toHaveText('Old route')
  await expect(page.getByText('Preparing...', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.thumbnailProbe.renders)).toBe(1)
  await selectZip(page, await zip([['route.gpx', routeGpx(line, 'New route')]]))
  await expectLoaded(page, 1)
  await expectImage(page, 'New route')
  await expect(page.getByRole('img', { name: 'Route preview for Old route' })).toHaveCount(0)
  await expect(page.locator('.route-error')).toHaveCount(0)
  expect(await cachedKeys(page)).toEqual([await routeKey(line)])
  expect(await page.evaluate(() => window.thumbnailProbe.urls.size)).toBe(1)
})

test('clearing the cache does not redraw current images or allow pending work to repopulate it', async ({ page }) => {
  await setup(page, { delay: 700, failures: 0 })
  const archive = await zip([['route.gpx', routeGpx()]])
  await selectZip(page, archive)
  await expect.poll(() => page.evaluate(() => window.thumbnailProbe.renders)).toBe(1)
  await page.getByRole('button', { name: 'Clear thumbnail cache' }).click()
  await expect(page.locator('.cache-notice')).toContainText('Thumbnail cache cleared.')
  await expectLoaded(page, 1)
  await expectImage(page)
  expect(await cachedKeys(page)).toEqual([])
  await selectZip(page, archive)
  await expectLoaded(page, 1)
  await expectImage(page)
  expect(await page.evaluate(() => window.thumbnailProbe.renders)).toBe(2)
  expect((await cachedKeys(page)).length).toBe(1)
  const imageUrl = await page.getByRole('img').getAttribute('src')
  await page.getByRole('button', { name: 'Clear thumbnail cache' }).click()
  await expect(page.locator('.cache-notice')).toContainText('Thumbnail cache cleared.')
  expect(await cachedKeys(page)).toEqual([])
  await expect(page.getByRole('img')).toHaveAttribute('src', imageUrl!)
  expect(await page.evaluate(() => window.thumbnailProbe.renders)).toBe(2)
})

test('supports many previews and keeps narrow layouts contained', async ({ page }) => {
  await setup(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await selectZip(page, await zip(Array.from({ length: 60 }, (_, index) => [
    `route-${index}.gpx`, routeGpx(triangle, `Route ${index}`),
  ])))
  await expectLoaded(page, 60)
  await expect(page.locator('.route-preview img')).toHaveCount(60)
  expect(await page.evaluate(() => window.thumbnailProbe.renders)).toBe(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
