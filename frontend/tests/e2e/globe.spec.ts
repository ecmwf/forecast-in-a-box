/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** The globe end to end on real WebGL; skips on software renderers, where the app withholds it. */

import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

const RUN_REF = 'run:job-completed-001~task-out-grib'

/** The app's own gate: hardware WebGL2 by name. */
async function hasHardwareWebGl(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const gl = document
      .createElement('canvas')
      .getContext('webgl2', { failIfMajorPerformanceCaveat: true })
    if (!gl) return false
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const name = String(
      info
        ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
    )
    return !/swiftshader|llvmpipe|softpipe|software/i.test(name)
  })
}

/** RGB at (fx, fy) of an element, via screenshot: WebGL buffers are unreadable once composited. */
async function pixelAt(
  page: Page,
  selector: string,
  fx: number,
  fy: number,
): Promise<[number, number, number]> {
  const box = await page.locator(selector).boundingBox()
  if (!box) throw new Error(`${selector} has no box`)
  const png = await page.screenshot({
    clip: {
      x: box.x + box.width * fx - 2,
      y: box.y + box.height * fy - 2,
      width: 4,
      height: 4,
    },
  })
  return page.evaluate(async (data) => {
    const img = new Image()
    img.src = `data:image/png;base64,${data}`
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const p = ctx.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data
    return [p[0], p[1], p[2]] as [number, number, number]
  }, png.toString('base64'))
}

/** How far a pixel leans to the mock layer's red or blue. */
const tint = ([r, g, b]: [number, number, number]) => Math.max(r, b) - g

const projectionButton = (page: Page) =>
  page.getByRole('button', { name: 'Projection & basemap' })

test.describe('3D globe', () => {
  test('bends a mocked run onto the sphere and back', async ({ page }) => {
    await page.goto('/')
    await page.waitForURL(/overview/, { timeout: 15000 })
    test.skip(!(await hasHardwareWebGl(page)), 'no hardware WebGL here')

    await page.goto(`/visualise?a=${encodeURIComponent(RUN_REF)}&b=off`)
    const consent = page.getByRole('button', { name: 'Add and connect' })
    if (await consent.isVisible({ timeout: 2000 }).catch(() => false)) {
      await consent.click()
    }
    // The mocked lens comes up and serves a solid-colour layer.
    await expect(projectionButton(page)).toBeVisible({ timeout: 20000 })
    await page.getByRole('button', { name: '2 m temperature' }).click()

    await projectionButton(page).click()
    await page.getByRole('radio', { name: /^3D globe/ }).click()
    await page.keyboard.press('Escape')

    const globe = page.getByRole('region', { name: '3D globe, source A' })
    await expect(globe).toBeVisible()
    await expect(projectionButton(page)).toHaveText('Globe')
    await expect(page).toHaveURL(/p=globe/)
    // The layer paints the sphere, not the panel around it.
    const panel = '[data-globe-panel="a"]'
    await expect(async () => {
      expect(tint(await pixelAt(page, panel, 0.5, 0.5))).toBeGreaterThan(30)
      expect(tint(await pixelAt(page, panel, 0.05, 0.5))).toBeLessThan(10)
    }).toPass({ timeout: 15000 })

    // Controls move the shared camera, which the URL mirrors.
    const zoomBefore = Number(
      new URL(page.url()).searchParams.get('cam')?.split(',')[2],
    )
    await globe
      .getByRole('group', { name: 'Zoom' })
      .getByRole('button', { name: 'Zoom in' })
      .click()
    await expect
      .poll(() =>
        Number(new URL(page.url()).searchParams.get('cam')?.split(',')[2]),
      )
      .toBeGreaterThan(zoomBefore)

    // P cycles back to the flat map.
    await page.keyboard.press('p')
    await expect(projectionButton(page)).toHaveText('Mercator')
    await expect(page).not.toHaveURL(/p=globe/)
    await expect(page.locator('.ol-viewport').first()).toBeVisible()
  })
})
