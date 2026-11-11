/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useFileDrop, useRefuseStrayFileDrops } from '@/hooks/useFileDrop'

function fileTransfer(): DataTransfer {
  const transfer = new DataTransfer()
  transfer.items.add(new File(['{}'], 'w.json', { type: 'application/json' }))
  return transfer
}

function textTransfer(): DataTransfer {
  const transfer = new DataTransfer()
  transfer.setData('text/plain', 'Map Plot')
  return transfer
}

function fire(
  target: Element,
  type: string,
  dataTransfer: DataTransfer,
): DragEvent {
  const event = new DragEvent(type, {
    bubbles: true,
    cancelable: true,
    dataTransfer,
  })
  target.dispatchEvent(event)
  return event
}

function Target({ onFile }: { onFile: (file: File) => void }) {
  const { isDragOver, dropHandlers } = useFileDrop(onFile)
  return (
    <div data-testid="target" {...dropHandlers}>
      {isDragOver ? 'over' : 'idle'}
    </div>
  )
}

function Page() {
  useRefuseStrayFileDrops()
  return <div data-testid="page">page</div>
}

describe('useFileDrop', () => {
  it('hands over a dropped file', async () => {
    const onFile = vi.fn()
    const screen = await render(<Target onFile={onFile} />)
    const target = screen.getByTestId('target').element()

    fire(target, 'dragenter', fileTransfer())
    await expect.element(screen.getByText('over')).toBeVisible()
    const drop = fire(target, 'drop', fileTransfer())

    expect(drop.defaultPrevented).toBe(true)
    expect(onFile).toHaveBeenCalledWith(expect.any(File))
    await expect.element(screen.getByText('idle')).toBeVisible()
  })

  it('lets drags without files pass, e.g. palette blocks', async () => {
    const onFile = vi.fn()
    const screen = await render(<Target onFile={onFile} />)
    const target = screen.getByTestId('target').element()

    expect(fire(target, 'dragenter', textTransfer()).defaultPrevented).toBe(
      false,
    )
    expect(fire(target, 'drop', textTransfer()).defaultPrevented).toBe(false)
    expect(onFile).not.toHaveBeenCalled()
    await expect.element(screen.getByText('idle')).toBeVisible()
  })
})

describe('useRefuseStrayFileDrops', () => {
  it('refuses files dropped outside a drop target', async () => {
    const screen = await render(<Page />)
    const page = screen.getByTestId('page').element()
    const transfer = fileTransfer()

    const over = fire(page, 'dragover', transfer)
    expect(over.defaultPrevented).toBe(true)
    expect(transfer.dropEffect).toBe('none')
    expect(fire(page, 'drop', transfer).defaultPrevented).toBe(true)
  })

  it('leaves other drags alone', async () => {
    const screen = await render(<Page />)
    const page = screen.getByTestId('page').element()

    expect(fire(page, 'dragover', textTransfer()).defaultPrevented).toBe(false)
  })
})
