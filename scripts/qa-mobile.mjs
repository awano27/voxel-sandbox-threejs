import { chromium, devices } from 'playwright'

const targetUrl = process.env.TARGET_URL ?? 'http://127.0.0.1:5173'
const screenshotPath = process.env.SCREENSHOT_PATH ?? 'docs/mobile-playwright-check.png'

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  ...devices['iPhone 13'],
})
const page = await context.newPage()

try {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const state = window.__VOXEL_DEBUG__?.getState()
    return Boolean(state && state.touchMode && state.loadedChunks > 0)
  })
  const startButton = page.getByRole('button', { name: 'START PLAYING' })

  if (await startButton.isVisible()) {
    await startButton.click()
    await page.waitForFunction(() => document.querySelector('.start-card')?.classList.contains('hidden') === true)
  }

  await page.waitForFunction(() => window.__VOXEL_DEBUG__?.getState().cameraMode === 'third-person')
  await page.locator('#action-camera').click()
  await page.waitForFunction(() => window.__VOXEL_DEBUG__?.getState().cameraMode === 'first-person')
  await page.locator('#action-camera').click()
  await page.waitForFunction(() => window.__VOXEL_DEBUG__?.getState().cameraMode === 'third-person')

  const initialState = await readDebugState(page)
  await dragControl(page, '#look-zone', { x: -80, y: -36 }, 180)
  const lookedState = await readDebugState(page)

  if (!initialState.target || !lookedState.target || `${initialState.target.block}` === `${lookedState.target.block}`) {
    throw new Error('Look zone check failed')
  }

  const beforeMove = await readDebugState(page)
  await dragControl(page, '#move-joystick', { x: 0, y: -48 }, 900)
  const afterMove = await readDebugState(page)

  if (Math.abs(afterMove.player.z - beforeMove.player.z) < 0.25 && Math.abs(afterMove.player.x - beforeMove.player.x) < 0.25) {
    throw new Error('Mobile movement check failed')
  }

  if ((afterMove.playground?.starsCollected ?? 0) < 1) {
    throw new Error('Mobile star trail check failed')
  }

  const beforeJumpY = afterMove.player.y
  await page.locator('#action-jump').click()
  await page.waitForTimeout(500)
  const peakState = await readDebugState(page)

  if (peakState.player.y <= beforeJumpY + 0.15) {
    throw new Error('Mobile jump check failed')
  }

  const targetState = await readDebugState(page)

  if (!targetState.target) {
    throw new Error('No mobile target under crosshair')
  }

  const [targetX, targetY, targetZ] = targetState.target.block

  await page.locator('#action-break').click()
  await page.waitForFunction(
    ([x, y, z]) => window.__VOXEL_DEBUG__?.peekBlock(x, y, z) === 0,
    [targetX, targetY, targetZ],
  )

  await page.locator('#mobile-block-toggle').click()
  await page.locator('#slot-5').click()
  await page.locator('#action-place').click()
  await page.waitForFunction(
    ([x, y, z]) => window.__VOXEL_DEBUG__?.peekBlock(x, y, z) === 5,
    [targetX, targetY, targetZ],
  )

  await page.screenshot({ path: screenshotPath, fullPage: true })
  console.log(JSON.stringify({ ok: true, screenshotPath }))
} finally {
  await browser.close()
}

async function dragControl(page, selector, delta, holdMs) {
  await page.evaluate(
    ({ selector: currentSelector, delta: currentDelta }) => {
      const element = document.querySelector(currentSelector)

      if (!(element instanceof HTMLElement)) {
        throw new Error(`Missing element: ${currentSelector}`)
      }

      const rect = element.getBoundingClientRect()
      const startX = rect.left + rect.width / 2
      const startY = rect.top + rect.height / 2

      element.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId: 41,
          pointerType: 'touch',
          clientX: startX,
          clientY: startY,
          bubbles: true,
        }),
      )
      element.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 41,
          pointerType: 'touch',
          clientX: startX + currentDelta.x,
          clientY: startY + currentDelta.y,
          bubbles: true,
        }),
      )
    },
    { selector, delta },
  )

  await page.waitForTimeout(holdMs)

  await page.evaluate((currentSelector) => {
    const element = document.querySelector(currentSelector)

    if (!(element instanceof HTMLElement)) {
      throw new Error(`Missing element: ${currentSelector}`)
    }

    const rect = element.getBoundingClientRect()
    const endX = rect.left + rect.width / 2
    const endY = rect.top + rect.height / 2

    element.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 41,
        pointerType: 'touch',
        clientX: endX,
        clientY: endY,
        bubbles: true,
      }),
    )
  }, selector)
}

async function readDebugState(page) {
  const state = await page.evaluate(() => window.__VOXEL_DEBUG__?.getState() ?? null)

  if (!state) {
    throw new Error('Debug API unavailable')
  }

  return state
}
