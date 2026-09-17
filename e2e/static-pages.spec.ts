import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { expectLoaded, gpx, selectZip, zip } from './fixtures'

test('project-path assets, private import, thumbnails, and schema-v2 writer handoff work without a backend', async ({ page }) => {
  const fixture = JSON.parse(readFileSync('fixtures/title-mapping-v2.json', 'utf8'))
  const requests: { url: string; method: string; body: string | null }[] = []
  page.on('request', (request) => requests.push({ url: request.url(), method: request.method(), body: request.postData() }))
  await page.goto('./')
  await expect(page).toHaveURL(/\/groomin\/$/)
  const archive = await zip([
    ['nested/garmin-1.gpx', gpx('<trk><name>Original 1</name><type>hiking</type><trkseg><trkpt lat="0" lon="0"><time>2025-01-01T10:00:00Z</time></trkpt><trkpt lat="1" lon="1"/></trkseg></trk>')],
    ['garmin-2.gpx', gpx('<trk><name>Original 2</name><type>hiking</type><trkseg><trkpt lat="0" lon="0"><time>2025-01-01T10:00:00Z</time></trkpt><trkpt lat="2" lon="2"/></trkseg></trk>')],
  ])
  await selectZip(page, archive)
  await expectLoaded(page, 2)
  await expect(page.getByRole('img', { name: 'Route preview for Original 1' })).toHaveJSProperty('naturalWidth', 240)
  await expect(page.getByRole('button', { name: /Connect Garmin|Apply to Garmin|Confirm .*rename/ })).toHaveCount(0)
  await expect(page.locator('input[type=password]')).toHaveCount(0)
  await page.getByRole('textbox', { name: 'New title for Original 1 (nested/garmin-1.gpx)', exact: true }).fill('Renamed 1')
  await page.getByRole('textbox', { name: 'New title for Original 2 (garmin-2.gpx)', exact: true }).fill('Renamed 2')
  await page.getByRole('button', { name: 'Select none', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save JSON (2)' }).click()
  const stream = await (await download).createReadStream()
  if (!stream) throw new Error('Missing JSON download')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  expect(JSON.parse(Buffer.concat(chunks).toString('utf8'))).toEqual({
    ...fixture, archiveFingerprint: createHash('sha256').update(archive).digest('hex'),
    changes: [...fixture.changes].reverse(),
  })
  const http = requests.filter((request) => request.url.startsWith('http'))
  expect(http.length).toBeGreaterThan(1)
  for (const request of http) {
    expect(request.method).toBe('GET')
    expect(request.body).toBeNull()
    expect(request.url).toMatch(/^http:\/\/127\.0\.0\.1:4175\/groomin\/(?:$|assets\/)/)
  }
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0)
})
