/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyToClipboard } from '@/lib/clipboard'

/** Consume payloads like a real clipboard write would. */
function consumingWriteSpy() {
  return vi
    .spyOn(navigator.clipboard, 'write')
    .mockImplementation(async (items) => {
      await Promise.all(
        items.flatMap((item) => item.types.map((type) => item.getType(type))),
      )
    })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('copyToClipboard', () => {
  it('calls clipboard.write before the data promise resolves (Safari gesture rule)', async () => {
    const write = vi.spyOn(navigator.clipboard, 'write').mockResolvedValue()
    const { promise, resolve } = deferred<Blob>()

    const done = copyToClipboard('image/png', promise)
    expect(write).toHaveBeenCalledTimes(1)

    resolve(new Blob(['png'], { type: 'image/png' }))
    await expect(done).resolves.toBeUndefined()
  })

  it('re-tags a blob whose type disagrees with the item key', async () => {
    const write = consumingWriteSpy()
    await copyToClipboard(
      'image/png',
      Promise.resolve(new Blob(['data'], { type: 'application/octet-stream' })),
    )
    const [items] = write.mock.calls[0]
    const blob = await items[0].getType('image/png')
    expect(blob.type).toBe('image/png')
  })

  it('wraps string data into a blob of the requested mime', async () => {
    const write = consumingWriteSpy()
    await copyToClipboard('text/plain', Promise.resolve('<svg/>'))
    const [items] = write.mock.calls[0]
    const blob = await items[0].getType('text/plain')
    expect(blob.type).toBe('text/plain')
    expect(await blob.text()).toBe('<svg/>')
  })

  it('rejects when the data resolves to null', async () => {
    consumingWriteSpy()
    await expect(
      copyToClipboard('image/png', Promise.resolve(null)),
    ).rejects.toThrow('Nothing to copy')
  })

  it('rejects without writing when the Clipboard API is unavailable', async () => {
    const write = vi.spyOn(navigator.clipboard, 'write').mockResolvedValue()
    vi.stubGlobal('ClipboardItem', undefined)
    await expect(
      copyToClipboard('image/png', Promise.resolve(new Blob())),
    ).rejects.toThrow('Clipboard API is not available')
    expect(write).not.toHaveBeenCalled()
  })

  it('falls back to an awaited payload when the constructor rejects promises', async () => {
    // Mimic older Chromium: ClipboardItem accepts only materialized values.
    class LegacyClipboardItem {
      constructor(readonly items: Record<string, unknown>) {
        if (Object.values(items).some((v) => v instanceof Promise)) {
          throw new TypeError('promise payloads unsupported')
        }
      }
    }
    vi.stubGlobal('ClipboardItem', LegacyClipboardItem)
    const write = vi.spyOn(navigator.clipboard, 'write').mockResolvedValue()

    await copyToClipboard(
      'image/png',
      Promise.resolve(new Blob(['png'], { type: 'image/png' })),
    )
    expect(write).toHaveBeenCalledTimes(1)
    const [items] = write.mock.calls[0]
    expect(
      (items[0] as unknown as LegacyClipboardItem).items['image/png'],
    ).toBeInstanceOf(Blob)
  })
})
