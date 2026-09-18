import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test, type Download, type Page } from './test'
import { createTitleMappingExport, pendingTitleChanges, type TitleMappingExport } from '../src/title-edits'
import { expectActivityNames, expectLoaded, gpx, selectZip, track, zip } from './fixtures'

declare global {
  interface Window {
    titleExportProbe: {
      reads: number
      failRead: boolean
      failDownload: boolean
      holdRead: boolean
      holdRender: boolean
      releaseRead: (() => void) | null
      releaseRender: (() => void) | null
      urls: Set<string>
    }
  }
}

const files: [string, string][] = [
  ['nested/garmin-1.gpx', gpx(track('Green Mountain', 'hiking', '2025-01-03T00:00:00Z'))],
  ['other/garmin-2.gpx', gpx(track('Green Mountain', 'running', '2025-01-02T00:00:00Z'))],
  ['garmin-3.gpx', gpx(track('Riverside Ride', 'cycling', '2025-01-01T00:00:00Z'))],
]
const title = (page: Page, path = 'nested/garmin-1.gpx', name = 'Green Mountain') =>
  page.getByRole('textbox', { name: `Title for ${name} (${path})`, exact: true })
const saveButton = (page: Page) => page.getByRole('button', { name: /^Save JSON \(\d+\)$/ })
const typeEditor = (page: Page, path = 'other/garmin-2.gpx', name = 'Green Mountain') =>
  page.getByRole('combobox', { name: `Activity type for ${name} (${path})`, exact: true })
async function chooseType(page: Page, value: string, path = 'other/garmin-2.gpx', name = 'Green Mountain') {
  const editor = typeEditor(page, path, name)
  await editor.focus()
  await editor.selectOption(value)
}
const change = (newTitle: string, sourceFile = 'nested/garmin-1.gpx', originalTitle = 'Green Mountain'): TitleMappingExport['changes'][number] => {
  const id = /garmin-(\d+)\.gpx$/.exec(sourceFile)?.[1]
  if (!id) throw new Error('The synthetic export fixture requires a Garmin filename.')
  return {
    sourceFile, originalTitle, newTitle, garminActivityId: id,
    recordedStartTime: `2025-01-0${id === '1' ? 3 : id === '2' ? 2 : 1}T00:00:00.000Z`,
    activityType: id === '2' ? 'Running' : id === '3' ? 'Cycling' : 'Hiking',
  }
}
const mapping = (archive: Buffer, changes: TitleMappingExport['changes']): TitleMappingExport =>
  ({ schemaVersion: 2, archiveFingerprint: createHash('sha256').update(archive).digest('hex'), changes })

async function setup(page: Page, archive?: Buffer, count = 3, skipped = 0) {
  const buffer = archive ?? await zip(files)
  await page.goto('./')
  await selectZip(page, buffer)
  await expectLoaded(page, count, skipped)
  return buffer
}

async function readDownload(download: Download): Promise<unknown> {
  expect(download.suggestedFilename()).toBe('garmin-title-mappings.json')
  const stream = await download.createReadStream()
  if (!stream) throw new Error('The requested JSON download has no readable contents.')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  return data
}

async function save(page: Page) {
  const requested = page.waitForEvent('download')
  await saveButton(page).click()
  const result = await readDownload(await requested)
  await expect(saveButton(page)).toBeEnabled()
  return result
}

async function cachedTitle(page: Page, id = '1', field: 'name' | 'type' = 'name') {
  return page.evaluate(async ({ id, field }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('groomin-activities', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<string | null>((resolve, reject) => {
        const tx = db.transaction('activities')
        const request = tx.objectStore('activities').get(id)
        tx.oncomplete = () => resolve(request.result?.metadata[field] ?? null)
        tx.onabort = () => reject(tx.error)
      })
    } finally { db.close() }
  }, { id, field })
}

async function installProbe(page: Page) {
  await page.addInitScript(() => {
    window.titleExportProbe = {
      reads: 0, failRead: false, failDownload: false, holdRead: false, holdRender: false,
      releaseRead: null, releaseRender: null, urls: new Set(),
    }
    const read = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = function () {
      window.titleExportProbe.reads++
      if (window.titleExportProbe.failRead) return Promise.reject(new Error('Synthetic archive read failure.'))
      if (window.titleExportProbe.holdRead) {
        window.titleExportProbe.holdRead = false
        return new Promise((resolve, reject) => {
          window.titleExportProbe.releaseRead = () => read.call(this).then(resolve, reject)
        })
      }
      return read.call(this)
    }
    const click = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function () {
      if (this.download && window.titleExportProbe.failDownload) throw new Error('Synthetic download failure.')
      click.call(this)
    }
    const create = URL.createObjectURL
    URL.createObjectURL = (object) => {
      const url = create(object)
      if (object instanceof Blob && object.type === 'application/json') window.titleExportProbe.urls.add(url)
      return url
    }
    const revoke = URL.revokeObjectURL
    URL.revokeObjectURL = (url) => {
      window.titleExportProbe.urls.delete(url)
      revoke(url)
    }
    const render = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      if (window.titleExportProbe.holdRender) {
        window.titleExportProbe.holdRender = false
        window.titleExportProbe.releaseRender = () => render.apply(this, args)
      } else render.apply(this, args)
    }
  })
}

const selectionHeader = (page: Page) => page.getByRole('region', { name: 'Activity selection', exact: true })
const bulkTitle = (page: Page) => page.getByRole('textbox', { name: 'Title for selected activities', exact: true })
const bulkType = (page: Page) => page.getByRole('combobox', { name: 'Type for selected activities', exact: true })
const selectAllActivities = (page: Page) => page.getByRole('button', { name: 'Select all shown activities', exact: true })
const selectNoActivities = (page: Page) => page.getByRole('button', { name: 'Select none of the activities', exact: true })
const selectActivity = (page: Page, path = 'nested/garmin-1.gpx', name = 'Green Mountain') =>
  page.getByRole('checkbox', { name: `Select ${name} (${path})`, exact: true })

test('activity selection supports keyboard checkboxes, filtered select all, and clearing hidden selections', async ({ page }) => {
  await setup(page)
  await expect(page.locator('tbody input[type=checkbox]')).toHaveCount(3)
  await expect(selectionHeader(page)).toContainText('0 selected')
  await expect(bulkTitle(page)).toHaveCount(0)
  await expect(selectNoActivities(page)).toBeDisabled()
  await selectActivity(page).focus()
  await selectActivity(page).press('Space')
  await expect(selectActivity(page)).toBeChecked()
  await expect(selectionHeader(page)).toContainText('1 selected')
  await expect(bulkTitle(page)).toHaveCount(0)
  await page.getByRole('searchbox').fill('Riverside')
  await selectAllActivities(page).click()
  await expect(selectionHeader(page)).toContainText('2 selected · 1 hidden by filters')
  await expect(bulkTitle(page)).toHaveValue('')
  await expect(bulkTitle(page)).toHaveAttribute('placeholder', 'Mixed titles')
  await expect(bulkType(page)).toHaveValue('')
  await bulkTitle(page).focus()
  await bulkType(page).focus()
  await expect(saveButton(page)).toBeDisabled()
  await page.getByRole('searchbox').fill('')
  await expect(selectActivity(page, 'other/garmin-2.gpx')).not.toBeChecked()
  await selectAllActivities(page).click()
  await expect(page.locator('tbody input[type=checkbox]:checked')).toHaveCount(3)
  await page.getByRole('button', { name: 'Select none', exact: true }).click()
  await expect(selectionHeader(page)).toContainText('3 selected · 3 hidden by filters')
  await expect(selectAllActivities(page)).toBeDisabled()
  await selectNoActivities(page).click()
  await expect(selectionHeader(page)).toContainText('0 selected')
  await expect(bulkTitle(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await expect(page.locator('tbody input[type=checkbox]:checked')).toHaveCount(0)
  await expect(saveButton(page)).toBeDisabled()
})

for (const grouped of [false, true]) {
  test(`bulk edits affect selected rows only and export hidden combined proposals${grouped ? ' across route bundles' : ''}`, async ({ page }) => {
    const archive = await setup(page, await zip(files.map(([path, contents]) => [
      path, contents.replace('</trkseg>', '<trkpt lat="0" lon="0.01"></trkpt></trkseg>'),
    ])))
    const requests: string[] = []
    page.on('request', (request) => { if (/^https?:/.test(request.url())) requests.push(request.url()) })
    await selectActivity(page).check()
    await selectActivity(page, 'other/garmin-2.gpx').check()
    await expect(bulkTitle(page)).toHaveValue('Green Mountain')
    await expect(bulkType(page)).toHaveValue('')
    if (grouped) {
      await page.getByRole('checkbox', { name: 'Group similar routes' }).check()
      await expect(page.locator('.route-bundle')).toHaveCount(1)
      await expect(page.locator('tbody input[type=checkbox]:checked')).toHaveCount(2)
    }
    await bulkType(page).selectOption('trail_running')
    await expect(title(page)).toHaveValue('Green Mountain')
    await expect(saveButton(page)).toHaveText('Save JSON (2)')
    await page.getByRole('button', { name: 'Hiking', exact: true }).click()
    await expect(selectionHeader(page)).toContainText('2 selected · 1 hidden by filters')
    await bulkTitle(page).fill('  Shared trail  ')
    await bulkTitle(page).press('Enter')
    await expect(bulkTitle(page)).not.toBeFocused()
    await expect(title(page, 'other/garmin-2.gpx')).toHaveValue('  Shared trail  ')
    await expect(title(page, 'garmin-3.gpx', 'Riverside Ride')).toHaveValue('Riverside Ride')
    await expect(typeEditor(page, 'garmin-3.gpx', 'Riverside Ride')).toHaveValue('cycling')
    await expect(typeEditor(page)).toHaveValue('trail_running')
    const expected = {
      ...mapping(archive, [
        { ...change('Shared trail'), newActivityType: 'trail_running' },
        { ...change('Shared trail', 'other/garmin-2.gpx'), newActivityType: 'trail_running' },
      ]),
      schemaVersion: 3,
    }
    expect(await save(page)).toEqual(expected)
    expect(await save(page)).toEqual(expected)
    expect(await cachedTitle(page)).toBe('Shared trail')
    expect(await cachedTitle(page, '1', 'type')).toBe('Trail Running')
    expect(await cachedTitle(page, '3')).toBe('Riverside Ride')
    await title(page, 'other/garmin-2.gpx').fill('Individual override')
    await expect(bulkTitle(page)).toHaveValue('')
    await bulkTitle(page).focus()
    await bulkType(page).focus()
    await expect(title(page, 'other/garmin-2.gpx')).toHaveValue('Individual override')
    await selectNoActivities(page).click()
    await expect(saveButton(page)).toHaveText('Save JSON (2)')
    await page.getByRole('button', { name: 'Hiking', exact: true }).click()
    await expect(title(page)).toHaveValue('  Shared trail  ')
    expect(requests).toEqual([])
  })
}

test('bulk title/type resets are independent and composition keys leave titles intact', async ({ page }) => {
  await setup(page)
  await selectAllActivities(page).click()
  await bulkType(page).selectOption('running')
  await expect(saveButton(page)).toHaveText('Save JSON (2)')
  await bulkTitle(page).fill('Shared title')
  for (const key of ['Enter', 'Escape']) {
    await bulkTitle(page).evaluate((input, key) => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, isComposing: true }))
    }, key)
    await expect(bulkTitle(page)).toBeFocused()
    await expect(bulkTitle(page)).toHaveValue('Shared title')
  }
  await expect(saveButton(page)).toHaveText('Save JSON (3)')
  await bulkType(page).focus()
  await bulkType(page).press('Escape')
  await expect(bulkType(page)).toHaveValue('')
  await expect(bulkTitle(page)).toHaveValue('Shared title')
  await expect(typeEditor(page)).toHaveValue('running')
  await expect(typeEditor(page, 'nested/garmin-1.gpx')).toHaveValue('hiking')
  await bulkTitle(page).press('Escape')
  await expectActivityNames(page, ['Green Mountain', 'Green Mountain', 'Riverside Ride'])
  await expect(saveButton(page)).toBeDisabled()
  for (const value of ['', '   ']) {
    await bulkTitle(page).fill('Temporary')
    await bulkTitle(page).fill(value)
    await expect(saveButton(page)).toBeDisabled()
    await bulkTitle(page).press('Tab')
    await expectActivityNames(page, ['Green Mountain', 'Green Mountain', 'Riverside Ride'])
  }
  await bulkTitle(page).fill('Green Mountain')
  await expect(saveButton(page)).toHaveText('Save JSON (1)')
})

test('bulk title-only edits retain schema 2, discard warnings, and archive-scoped selection', async ({ page }) => {
  const archive = await setup(page)
  await page.getByRole('searchbox').fill('Green')
  await selectAllActivities(page).click()
  await bulkTitle(page).fill('Shared title')
  const replacement = await zip([['garmin-10.gpx', gpx(track('Replacement', 'hiking', '2025-01-01T00:00:00Z'))]])
  page.once('dialog', (dialog) => dialog.dismiss())
  await selectZip(page, replacement)
  await expect(selectionHeader(page)).toContainText('2 selected')
  await expect(bulkTitle(page)).toHaveValue('Shared title')
  expect(await save(page)).toEqual(mapping(archive, [change('Shared title'), change('Shared title', 'other/garmin-2.gpx')]))
  await bulkTitle(page).fill('Later unsaved title')
  page.once('dialog', (dialog) => dialog.accept())
  await selectZip(page, replacement)
  await expectLoaded(page, 1)
  await expect(selectionHeader(page)).toContainText('0 selected')
  await expect(bulkTitle(page)).toHaveCount(0)
  await expect(saveButton(page)).toBeDisabled()
})

test('bulk selection includes unexportable activities without bypassing identity checks', async ({ page }) => {
  await setup(page, await zip([...files, ['missing-id.gpx', gpx(track('No ID', 'running', '2025-01-01T00:00:00Z'))]]), 4)
  await selectAllActivities(page).click()
  await bulkType(page).selectOption('trail_running')
  await expect(saveButton(page)).toHaveText('Save JSON (4)')
  await expect(saveButton(page)).toBeDisabled()
  await expect(page.locator('.export-error')).toContainText('No partial file will be exported')
  await selectNoActivities(page).click()
  await expect(saveButton(page)).toBeDisabled()
})

test('bulk controls fit a narrow viewport and row options stay lazy', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 })
  await setup(page)
  await selectAllActivities(page).click()
  await bulkType(page).selectOption('trail_running')
  await expect(page.locator('.activity-type option')).toHaveCount(6)
  await expect(bulkTitle(page)).toBeVisible()
  await expect(bulkType(page)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('type drafts include new categories, remain independent of titles, and can be discarded', async ({ page }) => {
  await setup(page)
  await expect(typeEditor(page)).toHaveValue('running')
  await expect(typeEditor(page).locator('option:checked')).toHaveText('Running')
  await expect(page.locator('tbody .type-label')).toHaveCount(3)
  await expect(page.locator('tbody span.type-label')).toHaveCount(0)
  await expect(saveButton(page)).toBeDisabled()
  await typeEditor(page).focus()
  await expect(typeEditor(page).getByRole('option', { name: 'Trail Running', exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: 'Hiking', exact: true }).click()
  await page.getByRole('button', { name: 'Cycling', exact: true }).click()
  await chooseType(page, 'trail_running')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(typeEditor(page).locator('option:checked')).toHaveText('Trail Running')
  await expect(saveButton(page)).toHaveText('Save JSON (1)')
  await title(page, 'other/garmin-2.gpx').fill('A trail run')
  await expect(saveButton(page)).toHaveText('Save JSON (1)')
  await chooseType(page, 'running')
  await expect(typeEditor(page).locator('option:checked')).toHaveText('Running')
  await expect(saveButton(page)).toHaveText('Save JSON (1)')
  await title(page, 'other/garmin-2.gpx').press('Escape')
  await expect(saveButton(page)).toBeDisabled()
  await chooseType(page, 'trail_running')
  await title(page, 'other/garmin-2.gpx').fill('   ')
  const exported = await save(page) as TitleMappingExport
  expect(exported.schemaVersion).toBe(3)
  expect(exported.changes[0]).toMatchObject({ activityType: 'Running', newActivityType: 'trail_running' })
  expect(exported.changes[0]).not.toHaveProperty('newTitle')
})

test('native type selectors populate on pointer or keyboard focus without mounting every category in every row', async ({ page }) => {
  await setup(page)
  await expect(page.locator('.activity-type option')).toHaveCount(3)
  const editor = typeEditor(page)
  await editor.click()
  await editor.press('End')
  await editor.press('Enter')
  await expect(editor).toHaveValue('walking')
  await title(page, 'other/garmin-2.gpx').focus()
  await expect(page.locator('.activity-type option')).toHaveCount(4)
  await editor.focus()
  await expect(editor.getByRole('option', { name: 'Trail Running', exact: true })).toHaveCount(1)
  await editor.press('Home')
  await editor.press('Enter')
  await expect(editor).toHaveValue('running')
  await expect(saveButton(page)).toBeDisabled()
})

for (const grouped of [false, true]) {
  test(`inline types support keyboard editing and Escape without resetting titles${grouped ? ' in route bundles' : ''}`, async ({ page }) => {
    await setup(page, await zip(files.map(([path, contents]) => [
      path,
      contents.replace('</trkseg>', '<trkpt lat="0" lon="0.01"></trkpt></trkseg>'),
    ])))
    if (grouped) {
      await page.getByRole('checkbox', { name: 'Group similar routes' }).check()
      await expect(page.locator('.route-bundle')).toHaveCount(1)
    }
    const name = title(page, 'other/garmin-2.gpx')
    const editor = typeEditor(page)
    await name.fill('Independent title draft')
    await name.press('Tab')
    await page.keyboard.press('Tab')
    await expect(editor).toBeFocused()
    await expect(editor).toHaveCSS('outline-style', 'solid')
    await editor.press('End')
    await expect(editor).toHaveValue('walking')
    await name.focus()
    await expect(editor.locator('option:checked')).toHaveText('Walking')
    await expect(editor).toHaveAttribute('title', 'Walking')
    await expect(typeEditor(page, 'nested/garmin-1.gpx')).toHaveValue('hiking')
    await expect(saveButton(page)).toHaveText('Save JSON (1)')
    await editor.focus()
    await editor.press('Escape')
    await expect(editor).toHaveValue('running')
    await expect(editor).not.toBeFocused()
    await expect(editor.locator('option:checked')).toHaveText('Running')
    await expect(name).toHaveValue('Independent title draft')
    await expect(saveButton(page)).toHaveText('Save JSON (1)')
    await name.press('Escape')
    await expect(saveButton(page)).toBeDisabled()
  })
}

test('inline type selectors preserve unknown, numeric, and unrecognized starting values', async ({ page }) => {
  const types = [
    { type: '', key: 'unknown', label: 'Unknown' },
    { type: '999', key: '999', label: '999' },
    { type: 'future_sport', key: 'future_sport', label: 'Future Sport' },
  ]
  await setup(page, await zip(types.map(({ type }, index) => [
    `garmin-${index + 1}.gpx`, gpx(track('Same name', type, '2025-01-01T00:00:00Z')),
  ])))
  for (const [index, { key, label }] of types.entries()) {
    const path = `garmin-${index + 1}.gpx`
    const editor = typeEditor(page, path, 'Same name')
    await expect(editor).toHaveValue(key)
    await expect(editor.locator('option:checked')).toHaveText(label)
    await chooseType(page, 'trail_running', path, 'Same name')
    await expect(editor.locator('option:checked')).toHaveText('Trail Running')
    await chooseType(page, key, path, 'Same name')
    await expect(editor.locator('option:checked')).toHaveText(label)
    await expect(saveButton(page)).toBeDisabled()
  }
})

test('exports one combined edit per activity and hidden type-only and title-only edits without requests', async ({ page }) => {
  const archive = await setup(page)
  const requests: string[] = []
  page.on('request', (request) => { if (/^https?:/.test(request.url())) requests.push(request.url()) })
  await chooseType(page, 'walking', 'nested/garmin-1.gpx')
  await title(page).fill('  Ridge walk  ')
  await chooseType(page, 'trail_running')
  await title(page, 'garmin-3.gpx', 'Riverside Ride').fill('River loop')
  await page.getByRole('checkbox', { name: 'Group similar routes' }).check()
  await expect(typeEditor(page)).toHaveValue('trail_running')
  await page.getByRole('searchbox').fill('no matching names')
  await expect(page.locator('tbody tr')).toHaveCount(0)
  const typeOnly = change('unused', 'other/garmin-2.gpx')
  delete typeOnly.newTitle
  const expected = {
    ...mapping(archive, [
      { ...change('Ridge walk'), newActivityType: 'walking' },
      { ...typeOnly, newActivityType: 'trail_running' },
      change('River loop', 'garmin-3.gpx', 'Riverside Ride'),
    ]),
    schemaVersion: 3,
  }
  expect(await save(page)).toEqual(expected)
  expect(await save(page)).toEqual(expected)
  expect(requests).toEqual([])
  await page.getByRole('searchbox').fill('')
  await expect(typeEditor(page)).toHaveValue('trail_running')
  await expect(title(page)).toHaveValue('  Ridge walk  ')
})

test('saved types warm-load as baselines while separate field exports preserve remembered values', async ({ page }) => {
  const archive = await setup(page)
  await title(page, 'other/garmin-2.gpx').fill('Saved name')
  await save(page)
  await title(page, 'other/garmin-2.gpx').press('Escape')
  await chooseType(page, 'trail_running')
  await save(page)
  expect(await cachedTitle(page, '2')).toBe('Saved name')
  expect(await cachedTitle(page, '2', 'type')).toBe('Trail Running')
  await chooseType(page, 'running')
  await title(page, 'other/garmin-2.gpx').fill('Final name')
  const titleOnly = await save(page) as TitleMappingExport
  expect(titleOnly.schemaVersion).toBe(2)
  expect(await cachedTitle(page, '2', 'type')).toBe('Trail Running')
  await page.reload()
  await selectZip(page, archive)
  await expectLoaded(page, 3)
  await expect(typeEditor(page, 'other/garmin-2.gpx', 'Final name')).toHaveValue('trail_running')
  await expect(typeEditor(page, 'other/garmin-2.gpx', 'Final name').locator('option:checked')).toHaveText('Trail Running')
  await expect(page.getByRole('button', { name: 'Trail Running', exact: true })).toBeVisible()
  await expect(saveButton(page)).toBeDisabled()
  await expect(page.locator('.cache-summary')).toHaveAttribute('data-extracted', '0')
  await chooseType(page, 'running', 'other/garmin-2.gpx', 'Final name')
  const reverted = await save(page) as TitleMappingExport
  expect(reverted.changes[0]).toMatchObject({ originalTitle: 'Final name', activityType: 'Trail Running', newActivityType: 'running' })
  await page.getByRole('button', { name: 'Clear activity cache' }).click()
  await expect(page.locator('.cache-notice')).toContainText('Activity cache cleared')
  await selectZip(page, archive)
  await expectLoaded(page, 3)
  await expect(typeEditor(page)).toHaveValue('running')
  await expect(page.getByRole('button', { name: 'Running', exact: true })).toBeVisible()
  await expect(title(page, 'other/garmin-2.gpx')).toHaveValue('Green Mountain')
})

test('type changes during a save are outside its snapshot and cache clearing prevents persistence', async ({ page }) => {
  await installProbe(page)
  await setup(page)
  await chooseType(page, 'trail_running')
  await page.evaluate(() => { window.titleExportProbe.holdRead = true })
  const downloading = page.waitForEvent('download')
  await saveButton(page).click()
  await expect.poll(() => page.evaluate(() => Boolean(window.titleExportProbe.releaseRead))).toBe(true)
  await chooseType(page, 'walking')
  await page.getByRole('button', { name: 'Clear activity cache' }).click()
  await expect(page.locator('.cache-notice')).toContainText('Activity cache cleared')
  await page.evaluate(() => window.titleExportProbe.releaseRead!())
  const exported = await readDownload(await downloading) as TitleMappingExport
  expect(exported.changes[0]?.newActivityType).toBe('trail_running')
  await expect(page.locator('.export-error')).toContainText('Some exported titles and types could not be remembered')
  expect(await cachedTitle(page, '2', 'type')).toBeNull()
  await expect(typeEditor(page)).toHaveValue('walking')
  await expect(page.locator('.draft-status')).toContainText('not included in the latest JSON export')
})

test('failed type exports keep drafts and never update remembered metadata', async ({ page }) => {
  await installProbe(page)
  await setup(page)
  await chooseType(page, 'trail_running')
  await page.evaluate(() => { window.titleExportProbe.failDownload = true })
  await saveButton(page).click()
  await expect(page.locator('.export-error')).toContainText('Synthetic download failure')
  await expect(typeEditor(page)).toHaveValue('trail_running')
  expect(await cachedTitle(page, '2', 'type')).toBe('Running')
  await expect(page.locator('.draft-status')).toContainText('not included in the latest JSON export')
})

test('unexported type-only changes warn before replacing an archive and cancellation preserves drafts', async ({ page }) => {
  await setup(page)
  await chooseType(page, 'trail_running')
  const replacement = await zip([['garmin-10.gpx', gpx(track('Replacement', 'hiking', '2025-01-01T00:00:00Z'))]])
  page.once('dialog', (dialog) => dialog.dismiss())
  await selectZip(page, replacement)
  await expect(typeEditor(page)).toHaveValue('trail_running')
  await save(page)
  await chooseType(page, 'walking')
  page.once('dialog', (dialog) => dialog.accept())
  await selectZip(page, replacement)
  await expectLoaded(page, 1)
  await expect(saveButton(page)).toBeDisabled()
})

test('type-only proposals retain identity and ambiguity checks and reject invalid targets', () => {
  const proposed = { ...change('unused'), newActivityType: 'trail_running' }
  delete proposed.newTitle
  for (const key of ['', 'unknown', 'Trail Running', 'trail-running', 'trail_running!', 'hiking']) {
    expect(() => createTitleMappingExport('a'.repeat(64), [{ ...proposed, newActivityType: key }], new Set())).toThrow(/type key/)
  }
  expect(() => createTitleMappingExport('a'.repeat(64), [{ ...proposed, newActivityType: undefined }], new Set())).toThrow(/change is required/)
  expect(() => createTitleMappingExport('a'.repeat(64), [{ ...proposed, activityType: 'Unknown' }], new Set())).toThrow(/known activity type/)
  expect(() => createTitleMappingExport('a'.repeat(64), [proposed], new Set([proposed.sourceFile]))).toThrow(/Duplicate GPX paths/)
  expect(() => createTitleMappingExport('a'.repeat(64), [proposed, { ...proposed, sourceFile: 'other/garmin-1.gpx' }], new Set())).toThrow(/same Garmin activity ID/)
})

test('type-only export matches the shared schema-3 writer fixture', async () => {
  const changes = pendingTitleChanges([{
    id: 'row', sourceFile: 'garmin-42.gpx', name: 'Morning run', type: 'Running',
    date: Date.parse('2025-01-02T00:00:00.000Z'), durationMs: null, distanceMeters: null,
  }], new Map(), new Map([['row', 'trail_running']]))
  const fixture = JSON.parse(await readFile(new URL('../fixtures/activity-mapping-v3.json', import.meta.url), 'utf8'))
  expect(createTitleMappingExport('a'.repeat(64), changes, new Set())).toEqual(fixture)
})

test('starts with prefilled inline titles and ignores blank or unchanged proposals', async ({ page }) => {
  await setup(page)
  await expect(page.getByRole('textbox')).toHaveCount(3)
  await expectActivityNames(page, ['Green Mountain', 'Green Mountain', 'Riverside Ride'])
  await expect(page.getByRole('columnheader')).toHaveText(['Select', 'Route', 'Elevation', 'Title', 'Type', 'Date (UTC)'])
  for (const value of ['', '   ', 'Green Mountain', '  Green Mountain  ']) {
    await title(page).fill(value)
    await expect(saveButton(page)).toHaveText('Save JSON (0)')
    await expect(saveButton(page)).toBeDisabled()
  }
  await title(page).fill('green mountain')
  await expect(saveButton(page)).toHaveText('Save JSON (1)')
  await expect(saveButton(page)).toBeEnabled()
  await expectActivityNames(page, ['green mountain', 'Green Mountain', 'Riverside Ride'])
  await title(page).fill('')
  await expect(saveButton(page)).toBeDisabled()
  await page.reload()
  await expect(page.getByText('Your activities will appear here')).toBeVisible()
})

test('inline editing supports clearing, typing, Enter, and restoring the imported title', async ({ page }) => {
  await setup(page)
  await page.getByRole('searchbox').fill('green')
  const editor = title(page)
  await editor.focus()
  await editor.press('ControlOrMeta+A')
  await editor.press('Backspace')
  await expect(editor).toBeEmpty()
  await expect(editor).toBeFocused()
  await expect(page.locator('tbody tr')).toHaveCount(2)
  await editor.pressSequentially('New ridge route')
  await expect(editor).toHaveValue('New ridge route')
  await expect(page.locator('tbody tr')).toHaveCount(2)
  await editor.press('Enter')
  await expect(editor).not.toBeFocused()
  await expect(editor).toHaveValue('New ridge route')
  await expect(saveButton(page)).toHaveText('Save JSON (1)')
  await editor.focus()
  await editor.press('Escape')
  await expect(editor).toHaveValue('Green Mountain')
  await expect(editor).not.toBeFocused()
  await expect(saveButton(page)).toBeDisabled()
  for (const blank of ['', '   ']) {
    await editor.fill(blank)
    await expect(editor).toHaveValue(blank)
    await editor.press('Tab')
    await expect(editor).toHaveValue('Green Mountain')
    await expect(saveButton(page)).toBeDisabled()
  }
  await editor.fill('Temporary draft')
  await editor.fill('Green Mountain')
  await expect(saveButton(page)).toBeDisabled()
  await expect(title(page, 'other/garmin-2.gpx')).toHaveValue('Green Mountain')
})

test('composition keys neither finish editing nor discard an in-progress title', async ({ page }) => {
  await setup(page)
  const editor = title(page)
  await editor.fill('Composing a title')
  for (const key of ['Enter', 'Escape']) {
    await editor.evaluate((input, key) => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, isComposing: true }))
    }, key)
    await expect(editor).toBeFocused()
    await expect(editor).toHaveValue('Composing a title')
    await expect(saveButton(page)).toHaveText('Save JSON (1)')
  }
  await editor.press('Escape')
  await expect(editor).toHaveValue('Green Mountain')
  await expect(saveButton(page)).toBeDisabled()
})

test('exports all hidden proposals with exact source paths, original titles, and the ZIP fingerprint', async ({ page }) => {
  const archive = await setup(page)
  const requests: string[] = []
  page.on('request', (request) => { if (/^https?:/.test(request.url())) requests.push(request.url()) })
  await title(page).fill('  Ridge "loop" & overlook  ')
  await title(page, 'other/garmin-2.gpx').fill('Morning trail run')
  await page.getByRole('searchbox').fill('Ridge')
  await expect(page.locator('tbody tr')).toHaveCount(0)
  await expect(saveButton(page)).toBeEnabled()
  await page.getByRole('button', { name: 'Select none', exact: true }).click()
  expect(await save(page)).toEqual(mapping(archive, [
    change('Ridge "loop" & overlook'),
    change('Morning trail run', 'other/garmin-2.gpx'),
  ]))
  await expect(page.locator('.export-notice')).toContainText('JSON download requested for 2 renames.')
  await expect(page.locator('.draft-status')).toContainText('Current proposals match the latest requested export.')
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await page.getByRole('searchbox').fill('Green')
  await expect(title(page)).toHaveValue('  Ridge "loop" & overlook  ')
  await expect(title(page, 'other/garmin-2.gpx')).toHaveValue('Morning trail run')
  await expectActivityNames(page, ['  Ridge "loop" & overlook  ', 'Morning trail run'])
  expect(requests).toEqual([])
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0)
  expect(await cachedTitle(page)).toBe('Ridge "loop" & overlook')
  expect(await cachedTitle(page, '2')).toBe('Morning trail run')
  expect(await cachedTitle(page, '3')).toBe('Riverside Ride')
})

test('repeated saves are complete current snapshots, reuse the hash, and release old download URLs', async ({ page }) => {
  await installProbe(page)
  const archive = await setup(page)
  const initialReads = await page.evaluate(() => window.titleExportProbe.reads)
  await title(page).fill('First title')
  const first = await save(page)
  expect(first).toEqual(mapping(archive, [change('First title')]))
  expect(await save(page)).toEqual(first)
  await title(page, 'other/garmin-2.gpx').fill('Second title')
  expect(await save(page)).toEqual(mapping(archive, [change('First title'), change('Second title', 'other/garmin-2.gpx')]))
  await title(page).fill('')
  expect(await save(page)).toEqual(mapping(archive, [change('Second title', 'other/garmin-2.gpx')]))
  expect(await page.evaluate(() => window.titleExportProbe.reads)).toBe(initialReads + 1)
  expect(await page.evaluate(() => window.titleExportProbe.urls.size)).toBe(1)
  await expect(page.locator('a[download]')).toHaveCount(0)
  await selectZip(page, await zip([['next.gpx', gpx()]]), 'next.zip')
  await expectLoaded(page, 1)
  expect(await page.evaluate(() => window.titleExportProbe.urls.size)).toBe(0)
  expect(await cachedTitle(page)).toBe('First title')
  await expect(saveButton(page)).toBeDisabled()
})

for (const failure of ['read', 'download']) {
  test(`reports ${failure} failure without losing drafts or marking them exported`, async ({ page }) => {
    await installProbe(page)
    const archive = await setup(page)
    await title(page).fill('Retry this title')
    await page.evaluate((failure) => {
      window.titleExportProbe.failRead = failure === 'read'
      window.titleExportProbe.failDownload = failure === 'download'
    }, failure)
    const downloads: Download[] = []
    page.on('download', (download) => downloads.push(download))
    await saveButton(page).click()
    await expect(page.getByRole('alert')).toContainText('Could not create JSON export.')
    await expect(title(page)).toHaveValue('Retry this title')
    await expect(page.locator('.draft-status')).toContainText('not included in the latest JSON export')
    expect(downloads).toHaveLength(0)
    expect(await page.evaluate(() => window.titleExportProbe.urls.size)).toBe(0)
    expect(await cachedTitle(page)).toBe('Green Mountain')
    await page.evaluate(() => {
      window.titleExportProbe.failRead = false
      window.titleExportProbe.failDownload = false
    })
    expect(await save(page)).toEqual(mapping(archive, [change('Retry this title')]))
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
}

test('edits made while export is preparing remain unexported and cannot change the captured snapshot', async ({ page }) => {
  await installProbe(page)
  const archive = await setup(page)
  await title(page).fill('At click time')
  await page.evaluate(() => { window.titleExportProbe.holdRead = true })
  const requested = page.waitForEvent('download')
  await saveButton(page).click()
  await expect.poll(() => page.evaluate(() => window.titleExportProbe.releaseRead !== null)).toBe(true)
  await expect(page.getByRole('button', { name: 'Preparing JSON...' })).toBeDisabled()
  await expect(page.getByLabel('Open GPX ZIP')).toBeDisabled()
  await title(page).fill('Edited while preparing')
  await page.evaluate(() => window.titleExportProbe.releaseRead?.())
  expect(await readDownload(await requested)).toEqual(mapping(archive, [change('At click time')]))
  await expect(title(page)).toHaveValue('Edited while preparing')
  await expect(page.locator('.draft-status')).toContainText('not included in the latest JSON export')
  await expect(saveButton(page)).toBeEnabled()
  expect(await cachedTitle(page)).toBe('At click time')
  expect(await save(page)).toEqual(mapping(archive, [change('Edited while preparing')]))
  expect(await cachedTitle(page)).toBe('Edited while preparing')
})

for (const failure of ['quota', 'missing-record']) {
  test(`JSON still downloads with a visible warning when titles cannot be remembered: ${failure}`, async ({ page }) => {
    const archive = await setup(page)
    await title(page).fill('Remember if possible')
    await page.evaluate(async (failure) => {
      if (failure === 'quota') {
        const put = IDBObjectStore.prototype.put
        IDBObjectStore.prototype.put = function (...args) {
          if (this.name === 'activities') throw new DOMException('Synthetic title storage failure.', 'QuotaExceededError')
          return put.apply(this, args)
        }
      } else {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('groomin-activities', 1)
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('activities', 'readwrite')
            tx.objectStore('activities').delete('1')
            tx.oncomplete = () => resolve()
            tx.onabort = () => reject(tx.error)
          })
        } finally { db.close() }
      }
    }, failure)
    expect(await save(page)).toEqual(mapping(archive, [change('Remember if possible')]))
    await expect(page.locator('.export-error')).toContainText('JSON download requested')
    await expect(page.locator('.export-error')).toContainText('Some exported titles could not be remembered')
    await expect(page.locator('.export-error')).toHaveAttribute('role', 'alert')
    expect(await cachedTitle(page)).toBe(failure === 'quota' ? 'Green Mountain' : null)
    await expect(title(page)).toHaveValue('Remember if possible')
  })
}

test('clearing during JSON preparation prevents the export from repopulating cached titles', async ({ page }) => {
  await installProbe(page)
  const archive = await setup(page)
  await title(page).fill('Do not repopulate')
  await page.evaluate(() => { window.titleExportProbe.holdRead = true })
  const requested = page.waitForEvent('download')
  await saveButton(page).click()
  await expect.poll(() => page.evaluate(() => window.titleExportProbe.releaseRead !== null)).toBe(true)
  await page.getByRole('button', { name: 'Clear activity cache' }).click()
  await expect(page.locator('.cache-notice')).toContainText('Activity cache cleared.')
  await page.evaluate(() => window.titleExportProbe.releaseRead?.())
  expect(await readDownload(await requested)).toEqual(mapping(archive, [change('Do not repopulate')]))
  await expect(page.locator('.export-error')).toContainText('Some exported titles could not be remembered')
  expect(await cachedTitle(page)).toBeNull()
})

test('drafts survive later thumbnail and import updates; export waits for import completion', async ({ page }) => {
  await installProbe(page)
  await page.goto('./')
  await page.evaluate(() => { window.titleExportProbe.holdRender = true })
  const archive = await zip([
    ['garmin-4.gpx', gpx('<trk><name>First route</name><type>hiking</type><trkseg><trkpt lat="0" lon="0"><time>2025-01-01T00:00:00Z</time></trkpt><trkpt lat="1" lon="1"/></trkseg></trk>')],
    ['second.gpx', gpx()],
  ])
  await selectZip(page, archive)
  await expect.poll(() => page.evaluate(() => window.titleExportProbe.releaseRender !== null)).toBe(true)
  await title(page, 'garmin-4.gpx', 'First route').fill('Draft during import')
  await expect(saveButton(page)).toBeDisabled()
  await page.evaluate(() => window.titleExportProbe.releaseRender?.())
  await expectLoaded(page, 2)
  await expect(title(page, 'garmin-4.gpx', 'First route')).toHaveValue('Draft during import')
  await expect(page.getByRole('img', { name: 'Route preview for First route' })).toHaveJSProperty('naturalWidth', 240)
  expect(await save(page)).toEqual(mapping(archive, [change('Draft during import', 'garmin-4.gpx', 'First route')]))
})

test('replacement warns before discarding unexported edits and cancellation preserves archive identity', async ({ page }) => {
  const archive = await setup(page)
  const replacement = await zip([['garmin-5.gpx', gpx(track('garmin-5.gpx', 'hiking', '2025-01-01T00:00:00Z'))]])
  await title(page).fill('Keep this draft')
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm')
    await dialog.dismiss()
  })
  await selectZip(page, replacement, 'replacement.zip')
  await expect(title(page)).toHaveValue('Keep this draft')
  await expect(page.locator('.archive-name')).toHaveText('Archive: synthetic.zip')
  expect(await save(page)).toEqual(mapping(archive, [change('Keep this draft')]))
  await title(page).fill('Another unexported draft')
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm')
    await dialog.accept()
  })
  await selectZip(page, replacement, 'replacement.zip')
  await expectLoaded(page, 1)
  await expect(page.getByRole('textbox')).toHaveValue('garmin-5.gpx')
  await expect(saveButton(page)).toBeDisabled()
  await expect(page.locator('.export-notice')).toHaveCount(0)
  await title(page, 'garmin-5.gpx', 'garmin-5.gpx').fill('New archive title')
  expect(await save(page)).toEqual(mapping(replacement, [change('New archive title', 'garmin-5.gpx', 'garmin-5.gpx')]))
})

test('browser navigation warns for unexported changes but not for a current exported snapshot', async ({ page }) => {
  await setup(page)
  await title(page).fill('Warn before leaving')
  const warning = page.waitForEvent('dialog')
  await page.evaluate(() => { setTimeout(() => window.location.reload(), 0) })
  const dialog = await warning
  expect(dialog.type()).toBe('beforeunload')
  await dialog.dismiss()
  await expect(title(page)).toHaveValue('Warn before leaving')
  await save(page)
  await title(page).fill('Temporary edit')
  await title(page).fill('Warn before leaving')
  await expect(page.locator('.draft-status')).toContainText('Current proposals match the latest requested export.')
  const dialogs: string[] = []
  page.on('dialog', async (next) => { dialogs.push(next.type()); await next.dismiss() })
  await page.reload()
  expect(dialogs).toEqual([])
  await expect(page.getByText('Your activities will appear here')).toBeVisible()
})

for (const unreadableSibling of [false, true]) {
  test(`duplicate GPX paths block affected proposals even when the other entry is ${unreadableSibling ? 'unreadable' : 'readable'}`, async ({ page }) => {
    const archive = await zip([
      ['same-a.gpx', gpx('<trk><name>Duplicate A</name></trk>')],
      ['same-b.gpx', unreadableSibling ? 'not XML' : gpx('<trk><name>Duplicate B</name></trk>')],
      ['garmin-6.gpx', gpx(track('Unique route', 'hiking', '2025-01-01T00:00:00Z'))],
    ])
    let replacements = 0
    for (let offset = archive.indexOf('same-b.gpx'); offset !== -1; offset = archive.indexOf('same-b.gpx', offset + 10)) {
      archive.set(Buffer.from('same-a.gpx'), offset)
      replacements++
    }
    expect(replacements).toBe(2)
    await setup(page, archive, unreadableSibling ? 2 : 3, unreadableSibling ? 1 : 0)
    await title(page, 'same-a.gpx', 'Duplicate A').fill('Ambiguous proposal')
    await title(page, 'garmin-6.gpx', 'Unique route').fill('Unambiguous proposal')
    await expect(saveButton(page)).toHaveText('Save JSON (2)')
    await expect(saveButton(page)).toBeDisabled()
    await expect(page.getByRole('alert')).toContainText('duplicate GPX paths')
    await title(page, 'same-a.gpx', 'Duplicate A').fill('')
    expect(await save(page)).toEqual(mapping(archive, [change('Unambiguous proposal', 'garmin-6.gpx', 'Unique route')]))
  })
}

test('export builder rejects invalid identity, empty batches, and repeated targets', () => {
  expect(() => createTitleMappingExport('invalid', [change('New')], new Set())).toThrow('fingerprint')
  expect(() => createTitleMappingExport('a'.repeat(64), [], new Set())).toThrow('no proposed')
  expect(() => createTitleMappingExport('a'.repeat(64), [change('One'), change('Two')], new Set())).toThrow('uniquely')
  expect(() => createTitleMappingExport('a'.repeat(64), [change('x'.repeat(1024 * 1024))], new Set())).toThrow('1 MiB')
})

for (const example of [
  { path: 'unverifiable.gpx', contents: track('Invalid identity', 'hiking', '2025-01-01T00:00:00Z'), reason: 'filename is required' },
  { path: 'garmin-2.gpx', contents: '<trk><name>Invalid identity</name><type>hiking</type></trk>', reason: 'recorded start time is required' },
  { path: 'garmin-2.gpx', contents: track('Invalid identity', '', '2025-01-01T00:00:00Z'), reason: 'known activity type is required' },
  { path: 'nested/garmin-1.gpx', contents: track('Invalid identity', 'hiking', '2025-01-01T00:00:00Z'), reason: 'same Garmin activity ID' },
]) {
  test(`identity validation blocks download with visible hidden-row reasons: ${example.reason}`, async ({ page }) => {
    await setup(page, await zip([
      ['garmin-1.gpx', gpx(track('Valid identity', 'hiking', '2025-01-01T00:00:00Z'))],
      [example.path, gpx(example.contents)],
    ]), 2)
    await title(page, 'garmin-1.gpx', 'Valid identity').fill('Valid proposal')
    await title(page, example.path, 'Invalid identity').fill('Blocked proposal')
    await page.getByRole('button', { name: 'Select none', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText(example.reason)
    await expect(saveButton(page)).toBeDisabled()
    await page.getByRole('button', { name: 'Select all', exact: true }).click()
    await title(page, example.path, 'Invalid identity').fill('')
    await expect(saveButton(page)).toBeEnabled()
  })
}
