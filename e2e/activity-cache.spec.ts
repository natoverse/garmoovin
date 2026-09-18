import { expect, test, type Page } from './test'
import { expectActivityNames, expectLoaded, gpx, selectZip, zip } from './fixtures'

declare global {
  interface Window {
    cacheProbe: { parses: number; hashes: number; renders: number; trigonometry: number }
  }
}

function recording(index: number, points = 250): string {
  const radians = Math.PI / 180
  const family = Math.floor(index / 5)
  return gpx(`<trk><name>Loop ${family} visit ${index}</name><type>hiking</type><trkseg>${
    Array.from({ length: points + 1 }, (_, step) => {
      const angle = step * Math.PI * 2 / points
      const lon = family * 0.02 + Math.cos(angle) * 80 / 6_371_008.8 / radians
      const lat = (Math.sin(angle) * 80 + index % 5 * 2) / 6_371_008.8 / radians
      return `<trkpt lon="${lon}" lat="${lat}"><ele>${100 + 20 * Math.sin(angle * 2)}</ele><time>2025-01-${String(index % 28 + 1).padStart(2, '0')}T00:00:00Z</time></trkpt>`
    }).join('')
  }</trkseg></trk>`)
}

async function probe(page: Page) {
  await page.addInitScript(() => {
    window.cacheProbe = { parses: 0, hashes: 0, renders: 0, trigonometry: 0 }
    const parse = DOMParser.prototype.parseFromString
    DOMParser.prototype.parseFromString = function (...args) {
      window.cacheProbe.parses++
      return parse.apply(this, args)
    }
    const hash = crypto.subtle.digest.bind(crypto.subtle)
    crypto.subtle.digest = (...args) => { window.cacheProbe.hashes++; return hash(...args) }
    const render = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      window.cacheProbe.renders++
      render.apply(this, args)
    }
    for (const name of ['sin', 'cos', 'asin', 'atan2', 'hypot'] as const) {
      const original = Math[name]
      Math[name] = (...args: number[]) => {
        window.cacheProbe.trigonometry++
        return Reflect.apply(original, Math, args)
      }
    }
  })
}

async function group(page: Page) {
  await page.getByRole('checkbox', { name: 'Group similar routes' }).check()
  await expect(page.locator('.similarity-count')).not.toContainText('Analysis pending', { timeout: 120_000 })
}

async function bundleNames(page: Page) {
  return page.locator('.route-bundle').evaluateAll((bundles) => bundles.map((bundle) =>
    Array.from(bundle.querySelectorAll<HTMLInputElement>('.activity-name'), (input) => input.value)))
}

async function storedKeys(page: Page, store = 'activities') {
  return page.evaluate(async (store) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('groomin-activities', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<IDBValidKey[]>((resolve, reject) => {
        const tx = db.transaction(store)
        const request = tx.objectStore(store).getAllKeys()
        tx.oncomplete = () => resolve(request.result)
        tx.onabort = () => reject(tx.error)
      })
    } finally { db.close() }
  }, store)
}

test('500 cached activities load within five seconds and regroup within two without repeating GPX or geometry work', async ({ page }) => {
  test.setTimeout(180_000)
  await probe(page)
  await page.goto('./')
  const archive = await zip(Array.from({ length: 500 }, (_, index) => [`garmin-${index + 1}.gpx`, recording(index)]))
  const coldStart = Date.now()
  await selectZip(page, archive)
  await expect(page.getByRole('status')).toContainText('Import complete. 500 activities loaded.', { timeout: 120_000 })
  await expectLoaded(page, 500)
  await group(page)
  const coldMilliseconds = Date.now() - coldStart
  const expected = await bundleNames(page)
  expect(expected).toHaveLength(100)
  expect(await storedKeys(page)).toHaveLength(500)
  expect(await storedKeys(page, 'pairs')).toHaveLength(1000)
  await page.reload()
  const start = Date.now()
  await selectZip(page, archive, 'reopened.zip')
  await expectLoaded(page, 500)
  await expect.poll(() => page.locator('.route-preview img').evaluateAll((images) =>
    images.every((image) => (image as HTMLImageElement).naturalWidth === 240))).toBe(true)
  await expect(page.locator('.elevation-preview svg')).toHaveCount(500)
  const warmMilliseconds = Date.now() - start
  await expect(page.locator('.cache-summary')).toHaveText('500 from cache · 0 processed')
  await expect(page.locator('.cache-summary')).toHaveAttribute('data-extracted', '0')
  await expect(page.locator('.cache-summary')).toHaveAttribute('data-prepared', '0')
  await expect(page.locator('.cache-summary')).toHaveAttribute('data-restored', '500')
  expect(await page.evaluate(() => window.cacheProbe)).toEqual({ parses: 0, hashes: 0, renders: 0, trigonometry: 0 })
  const groupStart = Date.now()
  await group(page)
  const groupMilliseconds = Date.now() - groupStart
  expect(await bundleNames(page)).toEqual(expected)
  await expect(page.locator('.cache-summary')).toHaveAttribute('data-compared', '0')
  const counters = await page.evaluate(() => window.cacheProbe)
  expect(counters).toMatchObject({ parses: 0, hashes: 0, renders: 0 })
  const measurements = JSON.stringify({ coldMilliseconds, warmMilliseconds, groupMilliseconds, counters })
  console.log(measurements)
  expect(warmMilliseconds, measurements).toBeLessThanOrEqual(5000)
  expect(groupMilliseconds, measurements).toBeLessThanOrEqual(2000)
  await page.getByRole('textbox').first().fill('Review batch title')
  await expect(page.getByRole('button', { name: 'Save JSON (1)' })).toBeEnabled()
})

test('overlapping archives restore only selected IDs and process only ten additions', async ({ page }) => {
  await probe(page)
  await page.goto('./')
  await selectZip(page, await zip(Array.from({ length: 10 }, (_, i) => [`garmin-${i + 1}.gpx`, recording(i)])))
  await expectLoaded(page, 10)
  await page.reload()
  await selectZip(page, await zip(Array.from({ length: 15 }, (_, i) => [`nested/GARMIN-${i + 6}.GPX`, recording(i + 5)])))
  await expectLoaded(page, 15)
  await expect(page.locator('.cache-summary')).toHaveText('5 from cache · 10 processed')
  expect((await page.evaluate(() => window.cacheProbe)).parses).toBe(10)
  expect(await storedKeys(page)).toHaveLength(20)
  await expect(page.locator('.activity-name[title="nested/GARMIN-6.GPX"]')).toHaveValue('Loop 1 visit 5')
  await expect(page.locator('.activity-name[title="garmin-1.gpx"]')).toHaveCount(0)
})

test('backfills legacy durations once without losing saved titles, previews, or pair scores', async ({ page }) => {
  await probe(page)
  await page.goto('./')
  const archive = await zip([
    ['garmin-1.gpx', recording(0).replace('T00:00:00Z', 'T01:02:59Z')],
    ['garmin-2.gpx', recording(1)],
    ['garmin-3.gpx', gpx()],
  ])
  await selectZip(page, archive)
  await expectLoaded(page, 3)
  const first = page.locator('tbody tr').filter({ has: page.locator('.activity-name[title="garmin-1.gpx"]') })
  await expect(first.locator('.activity-duration')).toContainText('01:02')
  await group(page)
  await page.locator('.activity-name[title="garmin-1.gpx"]').fill('Remembered title')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save JSON (1)' }).click()
  await download
  await expect(page.locator('.export-notice')).toContainText('Exported titles will be the starting titles on your next load.')
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('groomin-activities', 1)
      request.onsuccess = () => resolve(request.result)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('activities', 'readwrite')
        const store = tx.objectStore('activities')
        for (const id of ['1', '3']) {
          const request = store.get(id)
          request.onsuccess = () => {
            const record = request.result
            delete record.metadata.durationMs
            store.put(record, id)
          }
        }
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(tx.error)
      })
    } finally { db.close() }
  })
  await page.reload()
  await selectZip(page, archive)
  await expectLoaded(page, 3)
  await expect(page.locator('.cache-summary')).toHaveText('1 from cache · 2 processed')
  await expect(page.locator('.cache-summary')).toHaveAttribute('data-extracted', '2')
  await expect(first.locator('.activity-name')).toHaveValue('Remembered title')
  await expect(first.locator('.activity-duration')).toContainText('01:02')
  expect(await page.evaluate(() => window.cacheProbe)).toEqual({ parses: 2, hashes: 0, renders: 0, trigonometry: 0 })
  await group(page)
  await expect(page.locator('.cache-summary')).toHaveAttribute('data-compared', '0')
  expect(await storedKeys(page, 'pairs')).toHaveLength(1)
  await page.reload()
  await selectZip(page, archive)
  await expectLoaded(page, 3)
  await expect(page.locator('.cache-summary')).toHaveText('3 from cache · 0 processed')
  await expect(first.locator('.activity-name')).toHaveValue('Remembered title')
  await expect(first.locator('.activity-duration')).toContainText('01:02')
  await expect(page.locator('.activity-duration')).toHaveText([
    'Elapsed duration (hours:minutes): 00:00',
    'Elapsed duration (hours:minutes): 01:02',
    'Elapsed duration (hours:minutes): Unknown',
  ])
  expect(await page.evaluate(() => window.cacheProbe)).toEqual({ parses: 0, hashes: 0, renders: 0, trigonometry: 0 })
})

test('same-ID changes stay cached until manual clearing, including metadata, profiles and comparison results', async ({ page }) => {
  await probe(page)
  await page.goto('./')
  const original = await zip([['garmin-1.gpx', recording(0)], ['garmin-2.gpx', recording(1)]])
  await selectZip(page, original)
  await expectLoaded(page, 2)
  await group(page)
  expect(await storedKeys(page, 'pairs')).toHaveLength(1)
  const profile = await page.locator('.elevation-preview path').first().getAttribute('d')
  const changed = await zip([
    ['garmin-1.gpx', recording(0)],
    ['new/garmin-2.gpx', recording(50).replace('Loop 10 visit 50', 'Updated title')],
  ])
  await page.reload()
  await selectZip(page, changed)
  await expectLoaded(page, 2)
  await expect(page.locator('.cache-summary')).toHaveText('2 from cache · 0 processed')
  await expect(page.locator('.activity-name[title="new/garmin-2.gpx"]')).toHaveValue('Loop 0 visit 1')
  await expect(page.locator('.elevation-preview path').first()).toHaveAttribute('d', profile!)
  await group(page)
  await expect(page.locator('.route-bundle')).toHaveCount(1)
  await expect(page.locator('.cache-summary')).toHaveAttribute('data-compared', '0')
  const title = page.locator('.activity-name[title="new/garmin-2.gpx"]')
  await title.fill('Keep my draft')
  await page.getByRole('button', { name: 'Clear activity cache' }).click()
  await expect(page.locator('.cache-notice')).toContainText('Activity cache cleared.')
  await expect(title).toHaveValue('Keep my draft')
  expect(await storedKeys(page)).toEqual([])
  expect(await storedKeys(page, 'pairs')).toEqual([])
  page.once('dialog', (dialog) => dialog.accept())
  await selectZip(page, changed)
  await expectLoaded(page, 2)
  await expect(page.locator('.activity-name[title="new/garmin-2.gpx"]')).toHaveValue('Updated title')
  await expect(page.locator('.cache-summary')).toHaveText('0 from cache · 2 processed')
  await group(page)
  await expect(page.locator('.route-bundle')).toHaveCount(0)
})

test('missing geometry and elevation are cached, while no-ID and duplicate-ID entries remain independent and uncached', async ({ page }) => {
  await probe(page)
  await page.goto('./')
  const archive = await zip([
    ['garmin-9007199254740993.gpx', gpx('<trk><name>Empty activity</name></trk>')],
    ['no-id.gpx', recording(1)],
    ['first/garmin-2.gpx', recording(2)],
    ['second/garmin-2.gpx', recording(3)],
  ])
  await selectZip(page, archive)
  await expectLoaded(page, 4)
  expect(await storedKeys(page)).toEqual(['9007199254740993'])
  await page.reload()
  await selectZip(page, archive)
  await expectLoaded(page, 4)
  await expect(page.locator('.cache-summary')).toHaveText('1 from cache · 3 processed')
  await expect(page.locator('.activity-name[title="first/garmin-2.gpx"]')).toHaveValue('Loop 0 visit 2')
  await expect(page.locator('.activity-name[title="second/garmin-2.gpx"]')).toHaveValue('Loop 0 visit 3')
  const missing = page.locator('tbody tr').filter({ has: page.locator('.activity-name[title="garmin-9007199254740993.gpx"]') })
  await expect(missing.locator('.route-preview')).toHaveText('No route')
  await expect(missing.locator('.elevation-preview')).toHaveText('No elevation data')
})

test('a warm export uses current archive paths and its fingerprint without saving drafts', async ({ page }) => {
  await probe(page)
  await page.goto('./')
  await selectZip(page, await zip([['garmin-1.gpx', recording(0)]]))
  await expectLoaded(page, 1)
  await page.getByRole('textbox').fill('Old draft')
  await page.reload()
  const archive = await zip([['folder/garmin-1.gpx', 'This cached entry does not need XML extraction or parsing.']])
  await selectZip(page, archive)
  await expectLoaded(page, 1)
  await expectActivityNames(page, ['Loop 0 visit 0'])
  await expect(page.locator('.cache-summary')).toHaveAttribute('data-extracted', '0')
  const link = page.getByRole('link', { name: 'View on Garmin Connect for Loop 0 visit 0 (folder/garmin-1.gpx) (opens in a new tab)', exact: true })
  await expect(link).toHaveAttribute('href', 'https://connect.garmin.com/modern/activity/1')
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  await page.getByRole('textbox').fill('New proposed title')
  await expect(link).toHaveAttribute('href', 'https://connect.garmin.com/modern/activity/1')
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save JSON (1)' }).click()
  const stream = await (await downloading).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const mapping = JSON.parse(Buffer.concat(chunks).toString())
  const { createHash } = await import('node:crypto')
  expect(mapping.archiveFingerprint).toBe(createHash('sha256').update(archive).digest('hex'))
  expect(mapping.changes).toEqual([{
    sourceFile: 'folder/garmin-1.gpx', garminActivityId: '1', originalTitle: 'Loop 0 visit 0',
    newTitle: 'New proposed title', activityType: 'Hiking', recordedStartTime: '2025-01-01T00:00:00.000Z',
  }])
  expect((await page.evaluate(() => window.cacheProbe)).hashes).toBe(1)
  await expect(page.locator('.export-notice')).toContainText('Exported titles will be the starting titles on your next load.')
  await page.getByRole('textbox').fill('Unsaved later draft')
  await page.reload()
  await selectZip(page, archive)
  await expectLoaded(page, 1)
  await expectActivityNames(page, ['New proposed title'])
  await expect(page.getByRole('button', { name: 'Save JSON (0)' })).toBeDisabled()
  expect(await page.evaluate(() => window.cacheProbe)).toEqual({ parses: 0, hashes: 0, renders: 0, trigonometry: 0 })
  await expect(page.getByRole('link', { name: 'View on Garmin Connect for New proposed title (folder/garmin-1.gpx) (opens in a new tab)', exact: true }))
    .toHaveAttribute('href', 'https://connect.garmin.com/modern/activity/1')
  await page.getByRole('textbox').fill('Next batch title')
  const nextDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save JSON (1)' }).click()
  const nextStream = await (await nextDownload).createReadStream()
  const nextChunks: Buffer[] = []
  for await (const chunk of nextStream!) nextChunks.push(Buffer.from(chunk))
  expect(JSON.parse(Buffer.concat(nextChunks).toString()).changes[0]).toMatchObject({
    originalTitle: 'New proposed title', newTitle: 'Next batch title',
  })
})

test('saving a title preserves cached profiles and pair scores; clearing restores GPX titles', async ({ page }) => {
  await probe(page)
  await page.goto('./')
  const archive = await zip([['garmin-1.gpx', recording(0)], ['garmin-2.gpx', recording(1)]])
  await selectZip(page, archive)
  await expectLoaded(page, 2)
  await group(page)
  const profiles = await page.locator('.elevation-preview path').evaluateAll((paths) => paths.map((path) => path.getAttribute('d')))
  await page.locator('.activity-name[title="garmin-2.gpx"]').fill('Saved route title')
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save JSON (1)' }).click()
  await downloading
  await expect(page.locator('.export-notice')).toContainText('Exported titles will be the starting titles')
  await page.reload()
  await selectZip(page, archive)
  await expectLoaded(page, 2)
  await expectActivityNames(page, ['Saved route title', 'Loop 0 visit 0'])
  await expect(page.locator('.cache-summary')).toHaveText('2 from cache · 0 processed')
  expect(await page.evaluate(() => window.cacheProbe)).toEqual({ parses: 0, hashes: 0, renders: 0, trigonometry: 0 })
  expect(await page.locator('.elevation-preview path').evaluateAll((paths) => paths.map((path) => path.getAttribute('d')))).toEqual(profiles)
  await group(page)
  await expect(page.locator('.route-bundle')).toHaveCount(1)
  await expect(page.locator('.route-bundle h3')).toContainText('Saved route title')
  await expect(page.locator('.cache-summary')).toHaveAttribute('data-compared', '0')
  expect(await storedKeys(page, 'pairs')).toEqual([['1', '2']])
  await page.getByRole('searchbox').fill('Saved route title')
  await expectActivityNames(page, ['Saved route title'])
  await page.getByRole('button', { name: 'Clear activity cache' }).click()
  await expect(page.locator('.cache-notice')).toContainText('Activity cache cleared.')
  await selectZip(page, archive)
  await expectLoaded(page, 2)
  await expectActivityNames(page, ['Loop 0 visit 1', 'Loop 0 visit 0'])
})

test('persisted distances work at different tolerances without turning a loose match into a strict one', async ({ page }) => {
  await page.goto('./')
  const degrees = 180 / Math.PI / 6_371_008.8
  const line = (offset: number) => gpx(`<trk><name>Parallel ${offset}</name><trkseg>
    <trkpt lat="${offset * degrees}" lon="0"/><trkpt lat="${offset * degrees}" lon="${1000 * degrees}"/>
    </trkseg></trk>`)
  const archive = await zip([['garmin-1.gpx', line(0)], ['garmin-2.gpx', line(30)]])
  await selectZip(page, archive)
  await expectLoaded(page, 2)
  await group(page)
  await expect(page.locator('.route-bundle')).toHaveCount(1)
  expect(await storedKeys(page, 'pairs')).toEqual([['1', '2']])
  await page.reload()
  await selectZip(page, archive)
  await expectLoaded(page, 2)
  await page.getByRole('slider').fill('10')
  await group(page)
  await expect(page.locator('.route-bundle')).toHaveCount(0)
  await page.getByRole('slider').fill('40')
  await expect(page.locator('.similarity-count')).not.toContainText('Analysis pending')
  await expect(page.locator('.route-bundle')).toHaveCount(1)
  await expect(page.locator('.cache-summary')).toHaveAttribute('data-compared', '0')
})

for (const invalid of ['profile', 'geometry', 'version', 'pair']) {
  test(`invalid cached ${invalid} is reported and rebuilt rather than hiding activities`, async ({ page }) => {
    await page.goto('./')
    const archive = await zip([['garmin-1.gpx', recording(0)], ['garmin-2.gpx', recording(1)]])
    await selectZip(page, archive)
    await expectLoaded(page, 2)
    await group(page)
    await page.evaluate(async (invalid) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open('groomin-activities', 1)
        request.onsuccess = () => resolve(request.result)
      })
      const store = invalid === 'pair' ? 'pairs' : 'activities'
      const key = invalid === 'pair' ? ['1', '2'] : '1'
      const record = await new Promise<{
        elevation: unknown; geometry: { descriptor: { version: string }; tree: unknown }; score: unknown
      }>((resolve) => {
        const request = db.transaction(store).objectStore(store).get(key)
        request.onsuccess = () => resolve(request.result)
      })
      if (invalid === 'profile') record.elevation = { status: 'ready', distance: 'bad' }
      if (invalid === 'geometry') record.geometry.tree = { bounds: [0, 0, 0, 0, 0, 0], left: null, right: null }
      if (invalid === 'version') record.geometry.descriptor.version = 'incompatible'
      if (invalid === 'pair') record.score = 'not a distance'
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite')
        tx.objectStore(store).put(record, key)
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(tx.error)
      })
      db.close()
    }, invalid)
    await page.reload()
    await selectZip(page, archive)
    await expectLoaded(page, 2)
    await group(page)
    await expect(page.locator('.route-bundle')).toHaveCount(1)
    await expect(page.locator('.cache-warning')).toContainText('could not be read')
    if (invalid === 'pair') {
      await expect(page.locator('.cache-summary')).toHaveAttribute('data-compared', '1')
    } else {
      await expect(page.locator('.cache-summary')).toHaveText('1 from cache · 1 processed')
    }
  })
}

test('clearing during analysis prevents old-session pair writes while keeping the current view usable', async ({ page }) => {
  await page.goto('./')
  const archive = await zip([['garmin-1.gpx', recording(0)], ['garmin-2.gpx', recording(1)]])
  await selectZip(page, archive)
  await expectLoaded(page, 2)
  await page.evaluate(() => {
    const timer = window.setTimeout.bind(window)
    const pending: (() => void)[] = []
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (typeof handler === 'function' && (!delay || delay <= 10)) {
        pending.push(() => handler(...args))
        return 0
      }
      return timer(handler, delay, ...args)
    }) as typeof window.setTimeout
    Object.assign(window, { releaseCacheTestTimers: () => {
      window.setTimeout = timer
      for (const callback of pending) callback()
    } })
  })
  await page.getByRole('checkbox', { name: 'Group similar routes' }).check()
  await expect(page.locator('.similarity-count')).toContainText('Analysis pending')
  await page.getByRole('button', { name: 'Clear activity cache' }).click()
  await expect(page.locator('.cache-notice')).toContainText('Activity cache cleared.')
  await page.evaluate(() => Reflect.get(window, 'releaseCacheTestTimers')())
  await expect(page.locator('.similarity-count')).not.toContainText('Analysis pending')
  await expect(page.locator('.route-bundle')).toHaveCount(1)
  expect(await storedKeys(page)).toEqual([])
  expect(await storedKeys(page, 'pairs')).toEqual([])
  await selectZip(page, archive)
  await expectLoaded(page, 2)
  await group(page)
  expect(await storedKeys(page)).toHaveLength(2)
  expect(await storedKeys(page, 'pairs')).toHaveLength(1)
})

test('a transient preview failure is not saved as a permanent activity result', async ({ page }) => {
  await page.goto('./')
  await page.evaluate(() => {
    const render = HTMLCanvasElement.prototype.toBlob
    let failed = false
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      if (!failed) { failed = true; args[0](null) }
      else render.apply(this, args)
    }
  })
  const archive = await zip([['garmin-1.gpx', recording(0)]])
  await selectZip(page, archive)
  await expectLoaded(page, 1)
  await expect(page.locator('.route-error')).toHaveText('Thumbnail unavailable')
  expect(await storedKeys(page)).toEqual([])
  await selectZip(page, archive)
  await expectLoaded(page, 1)
  await expect(page.locator('.route-preview img')).toHaveJSProperty('naturalWidth', 240)
  expect(await storedKeys(page)).toEqual(['1'])
  await page.reload()
  await selectZip(page, archive)
  await expectLoaded(page, 1)
  await expect(page.locator('.cache-summary')).toHaveText('1 from cache · 0 processed')
})
