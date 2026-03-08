import { chromium } from 'playwright'

const targetUrl = process.env.TARGET_URL ?? 'https://awano27.github.io/voxel-sandbox-threejs/'
const screenshotPath = process.env.SCREENSHOT_PATH ?? 'docs/public-playwright-check.png'

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } })
const page = await context.newPage()

try {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__VOXEL_DEBUG__?.getState().loadedChunks > 0)
  await page.screenshot({ path: screenshotPath, fullPage: true })
  console.log(JSON.stringify({ ok: true, screenshotPath, url: targetUrl }))
} finally {
  await browser.close()
}
