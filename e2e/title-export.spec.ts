import { createHash } from 'node:crypto'
import { expect, test, type Download, type Page } from './test'
import { createTitleMappingExport, type TitleMappingExport } from '../src/title-edits'
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
  return readDownload(await requested)
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

test('starts with prefilled inline titles and ignores blank or unchanged proposals', async ({ page }) => {
  await setup(page)
  await expect(page.getByRole('textbox')).toHaveCount(3)
  await expectActivityNames(page, ['Green Mountain', 'Green Mountain', 'Riverside Ride'])
  await expect(page.getByRole('columnheader')).toHaveText(['Route', 'Elevation', 'Title', 'Type', 'Date (UTC)'])
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
  expect(await save(page)).toEqual(mapping(archive, [change('Edited while preparing')]))
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
