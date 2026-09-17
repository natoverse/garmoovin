import { test as base } from '@playwright/test'

export { expect, type Page, type Download } from '@playwright/test'

export const test = base.extend({
  page: async ({ page }, use) => {
    // Exercise fallback fonts deterministically; production still uses the CDN.
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ contentType: 'text/css', body: '' }))
    await page.route('https://fonts.gstatic.com/**', (route) => route.abort('blockedbyclient'))
    await use(page)
  },
})
