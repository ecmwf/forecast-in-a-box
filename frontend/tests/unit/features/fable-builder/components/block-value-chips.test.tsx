/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import type { BlockValueEntry } from '@/features/fable-builder/utils/block-values'
import { BlockValueChips } from '@/features/fable-builder/components/graph-mode/nodes/BlockValueChips'
// Real strings for the chips and tooltips.
import '@/lib/i18n'

const entry = (
  key: string,
  title: string,
  value: string,
  isDefault = false,
): BlockValueEntry => ({ key, title, value, isDefault })

// Map Plot's values, choices first.
const ENTRIES = [
  entry('param', 'Parameters', '2t'),
  entry('domain', 'Domain', 'Malawi'),
  entry('format', 'Format', 'png', true),
  entry('groupby', 'Group By', 'none', true),
  entry('splitby', 'Split By', 'step', true),
]

beforeAll(() => {
  // Browser tests run without Tailwind; the wrap needs these three.
  const style = document.createElement('style')
  style.textContent =
    '.flex{display:flex}.flex-wrap{flex-wrap:wrap}.gap-1\\.5{gap:6px}'
  document.head.append(style)
})

function renderChips(width: number) {
  return render(
    <div data-testid="card" style={{ width }}>
      <BlockValueChips
        entries={ENTRIES}
        labels={{}}
        choiceClassName="choice-colour"
      />
    </div>,
  )
}

/** The rendered chip row. */
function chipRow(): Array<HTMLElement> {
  const row = document.querySelector('[data-testid="card"] > div')
  return Array.from(row?.children ?? []) as Array<HTMLElement>
}

const shownChips = () => chipRow().map((el) => el.textContent)

describe('BlockValueChips', () => {
  it('styles choices and defaults alike, in the block colour', async () => {
    const screen = await renderChips(800)
    for (const text of ['Malawi', 'png']) {
      const chip = screen.getByText(text)
      await expect.element(chip).toHaveClass('choice-colour')
      await expect.element(chip).toHaveClass('font-semibold')
    }
  })

  it('names the setting of a chip on hover, marking defaults', async () => {
    const screen = await renderChips(800)
    await userEvent.hover(screen.getByText('png').last())
    await expect.element(screen.getByText('Format · default')).toBeVisible()
  })

  it('shows every value when they fit in two rows', async () => {
    await renderChips(800)
    await expect
      .poll(shownChips)
      .toEqual(['2t', 'Malawi', 'png', 'none', 'step'])
  })

  it('keeps two rows on a narrow card, dropping defaults first', async () => {
    // Unstyled chips are small: 70 px forces a third row.
    const screen = await renderChips(70)
    await expect.poll(() => shownChips().at(-1)).toMatch(/^\+\d more$/)
    const chips = shownChips()
    // Choices stay; the defaults go behind "+N more".
    expect(chips.slice(0, 2)).toEqual(['2t', 'Malawi'])
    const hiddenCount = ENTRIES.length - (chips.length - 1)
    expect(chips.at(-1)).toBe(`+${hiddenCount} more`)
    expect(new Set(chipRow().map((el) => el.offsetTop)).size).toBe(2)

    await userEvent.hover(screen.getByText(`+${hiddenCount} more`).last())
    await expect.element(screen.getByText('Split By')).toBeVisible()
  })

  it('measures again once a late font has loaded', async () => {
    // Stand-in for the fallback font: chips render wide first.
    const font = document.createElement('style')
    font.textContent = '.text-xs{font-size:24px}'
    document.head.append(font)
    try {
      await renderChips(120)
      await expect.poll(() => shownChips().at(-1)).toMatch(/^\+\d more$/)
      font.textContent = '.text-xs{font-size:10px}'
      document.fonts.dispatchEvent(new Event('loadingdone'))
      await expect
        .poll(shownChips)
        .toEqual(['2t', 'Malawi', 'png', 'none', 'step'])
    } finally {
      font.remove()
    }
  })
})
