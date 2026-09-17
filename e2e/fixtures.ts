import { expect, type Page } from '@playwright/test'
import { TextReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js'

export const gpx = (body = '') =>
  `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`
export const point = (date: string) => `<trkpt lat="0" lon="0"><time>${date}</time></trkpt>`
export const track = (name: string, type: string, date: string) =>
  `<trk><name>${name}</name><type>${type}</type><trkseg>${point(date)}</trkseg></trk>`

export async function zip(files: [string, string][], options: { level?: number; password?: string } = {}) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false })
  for (const [name, contents] of files) {
    await writer.add(name, new TextReader(contents), options)
  }
  return Buffer.from(await writer.close())
}

export async function selectZip(page: Page, buffer: Buffer, name = 'synthetic.zip') {
  await page.getByLabel('Open GPX ZIP').setInputFiles({ name, mimeType: 'application/zip', buffer })
}

export async function expectLoaded(page: Page, count: number, skipped = 0) {
  await expect(page.getByRole('status')).toContainText(`Import complete. ${count} ${count === 1 ? 'activity' : 'activities'} loaded. ${skipped} skipped.`)
  await expect(page.locator('tbody tr')).toHaveCount(count)
}

export async function expectMetadataRows(page: Page, rows: string[]) {
  await expect.poll(() => page.locator('tbody tr').evaluateAll((elements) =>
    elements.map((row) => Array.from(row.querySelectorAll('.activity-name, .type-label, .activity-date'), (cell) =>
      cell instanceof HTMLInputElement ? cell.value : cell.textContent,
    ).join('')),
  )).toEqual(rows)
}

export async function expectActivityNames(page: Page, names: string[]) {
  await expect.poll(() => page.locator('.activity-name').evaluateAll((inputs: HTMLInputElement[]) =>
    inputs.map((input) => input.value),
  )).toEqual(names)
}
