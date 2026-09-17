import { readFileSync } from 'node:fs'
import { expect, test } from './test'
import { expectLoaded, gpx, selectZip, zip } from './fixtures'

for (const width of [320, 768, 1440]) {
  test(`supplied theme and logo remain usable at ${width}px with CDN fonts unavailable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('./')
    await expect(page.getByRole('img', { name: 'Groomin logo' })).toHaveJSProperty('naturalWidth', 1536)
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(251, 243, 226)')
    await expect(page.locator('body')).toHaveCSS('color', 'rgb(46, 26, 12)')
    await expect(page.locator('body')).toHaveCSS('font-family', /Hanken Grotesk/)
    await expect(page.locator('h1')).toHaveCSS('font-family', /Bagel Fat One/)
    await expect(page.locator('.file-picker')).toHaveCSS('background-color', 'rgb(184, 74, 28)')
    await expect(page.locator('.file-picker')).toHaveCSS('transition-duration', '0s')
    await page.keyboard.press('Tab')
    await expect(page.getByLabel('Open GPX ZIP')).toBeFocused()
    await expect(page.locator('.file-picker')).toHaveCSS('outline-color', 'rgb(95, 107, 51)')

    await selectZip(page, await zip([
      ['garmin-1.gpx', gpx('<trk><name>Autumn trail</name><type>hiking</type><trkseg><trkpt lat="0" lon="0"><time>2025-01-01T10:00:00Z</time></trkpt><trkpt lat="1" lon="1"/></trkseg></trk>')],
    ]))
    await expectLoaded(page, 1)
    const image = page.getByRole('img', { name: 'Route preview for Autumn trail' })
    await expect(image).toHaveJSProperty('naturalWidth', 240)
    expect(await image.evaluate((element: HTMLImageElement) => {
      const canvas = document.createElement('canvas')
      canvas.width = 240
      canvas.height = 160
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Missing canvas context')
      context.drawImage(element, 0, 0)
      return Array.from(context.getImageData(0, 0, 1, 1).data)
    })).toEqual([245, 231, 200, 255])
    await page.getByRole('textbox', { name: /^New title for Autumn trail/ }).fill('Golden hour trail')
    await page.getByRole('checkbox', { name: 'Group similar routes' }).check()
    await expect(page.getByRole('button', { name: 'Save JSON (1)' })).toBeEnabled()
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Save JSON (1)' }).click()
    expect((await download).suggestedFilename()).toBe('garmin-title-mappings.json')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await expect(page.locator('.activity-date')).toHaveCSS('font-family', /Space Mono/)
  })
}

test('README embeds the same logo used in the website', () => {
  expect(readFileSync('README.md', 'utf8')).toMatch(/^<img src="src\/assets\/groomin-logo\.jpg" alt="Groomin logo"/)
  expect(readFileSync('src/assets/groomin-logo.jpg').length).toBeLessThan(400 * 1024)
})

test('font requests expose only the fixed public typography query and no referrer', async ({ page }) => {
  const fonts: { url: string; referrer: string | undefined }[] = []
  page.on('request', (request) => {
    if (request.url().startsWith('https://fonts.googleapis.com/')) {
      fonts.push({ url: request.url(), referrer: request.headers().referer })
    }
  })
  await page.goto('./')
  expect(fonts).toHaveLength(1)
  expect(fonts[0]?.referrer).toBeUndefined()
  await expect(page.locator('link[rel=stylesheet][href^="https://fonts.googleapis.com"]')).toHaveAttribute('referrerpolicy', 'no-referrer')
})
