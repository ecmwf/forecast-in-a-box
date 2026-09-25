/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useState } from 'react'
import { HttpResponse, delay, http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { worker } from '@tests/test-extend'
import { renderWithProviders } from '@tests/utils/render'
import type { OutputItem } from '@/features/executions/outputs/types'
import { API_ENDPOINTS } from '@/api/endpoints'
import { imageRasterAdapter } from '@/features/executions/outputs/adapters/image'
import ImageViewer from '@/features/executions/outputs/viewers/ImageViewer'

const item = (taskId: string): OutputItem => ({
  jobId: 'job-completed-001',
  taskId,
  mimeType: 'image/png',
  originalBlock: `block-${taskId}`,
  isAvailable: true,
})

async function pngOfSize(width: number, height: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height)
  canvas.getContext('2d')?.fillRect(0, 0, width, height)
  return canvas.convertToBlob({ type: 'image/png' })
}

// Serves a 400x300 PNG; `slow` answers after 1 s.
function serveImages(slow?: string) {
  worker.use(
    http.get(API_ENDPOINTS.job.outputContent, async ({ request }) => {
      const taskId = new URL(request.url).searchParams.get('dataset_id')
      if (taskId === slow) await delay(1000)
      return new HttpResponse(await pngOfSize(400, 300), {
        headers: { 'Content-Type': 'image/png' },
      })
    }),
  )
}

async function renderViewer(taskId = 'a') {
  const screen = await renderWithProviders(
    <ImageViewer
      item={item(taskId)}
      adapter={imageRasterAdapter}
      onClose={() => {}}
    />,
  )
  await expect.element(screen.getByRole('img')).toBeInTheDocument()
  return screen
}

const zoomLabel = () =>
  [...document.querySelectorAll('[role=dialog] header span')]
    .map((s) => s.textContent)
    .find((text) => text.endsWith('%'))

const stage = () =>
  document.querySelector('[role=dialog] img')?.parentElement as HTMLElement

describe('ImageViewer', () => {
  beforeEach(() => serveImages())

  it('handles the wheel itself so the page behind neither scrolls nor zooms', async () => {
    await renderViewer()
    const wheel = new WheelEvent('wheel', {
      deltaY: -100,
      bubbles: true,
      cancelable: true,
    })
    stage().dispatchEvent(wheel)
    expect(wheel.defaultPrevented).toBe(true)
  })

  it('zooms in proportion to the wheel delta, not per event', async () => {
    await renderViewer()
    // One pinch: many tiny ctrl+wheel deltas.
    for (let i = 0; i < 40; i++) {
      stage().dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -2,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )
    }
    await expect.poll(zoomLabel).toBe('223%')
  })

  it('keeps the point under the cursor fixed while zooming', async () => {
    await renderViewer()
    const rect = stage().getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    stage().dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -100,
        clientX: cx + 100,
        clientY: cy,
        bubbles: true,
        cancelable: true,
      }),
    )
    const img = document.querySelector('[role=dialog] img') as HTMLElement
    // Scale e^0.2; the offset keeps the cursor point fixed.
    await expect
      .poll(() => img.style.transform)
      .toMatch(/translate\(-22\.14\d*px, 0px\) scale\(1\.2214/)
  })

  it('shows hard pixel edges only once pixels are enlarged', async () => {
    const screen = await renderViewer()
    const img = document.querySelector('[role=dialog] img') as HTMLElement
    await expect.poll(() => img.style.imageRendering).toBe('auto')

    // Unstyled overlay fails actionability checks; click via the DOM.
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' }).element()
    for (let i = 0; i < 4; i++) (zoomIn as HTMLElement).click()
    await expect.poll(() => img.style.imageRendering).toBe('pixelated')
  })

  it('keeps the current image up until the next one is ready', async () => {
    serveImages('b')
    function Harness() {
      const [taskId, setTaskId] = useState('a')
      return (
        <>
          <button type="button" onClick={() => setTaskId('b')}>
            next
          </button>
          <ImageViewer
            item={item(taskId)}
            adapter={imageRasterAdapter}
            onClose={() => {}}
          />
        </>
      )
    }
    const screen = await renderWithProviders(<Harness />)
    const img = screen.getByRole('img')
    await expect.element(img).toBeInTheDocument()
    const firstSrc = img.element().getAttribute('src')

    ;(
      screen.getByRole('button', { name: 'next' }).element() as HTMLElement
    ).click()
    // Still showing image a while b downloads.
    await new Promise((r) => setTimeout(r, 300))
    expect(img.element().getAttribute('src')).toBe(firstSrc)
    await expect
      .poll(() => img.element().getAttribute('src'), { timeout: 3000 })
      .not.toBe(firstSrc)
  })
})
