/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { Reveal } from '@/components/common/Reveal'

describe('Reveal', () => {
  it('keeps the last content while closing, then drops it', async () => {
    const screen = await render(
      <Reveal open>
        <p>Missing required value</p>
      </Reveal>,
    )
    const message = screen.getByText('Missing required value')
    await expect.element(message).toBeVisible()

    await screen.rerender(<Reveal open={false}>{null}</Reveal>)
    // Still there (hidden from assistive tech) while it slides shut.
    await expect.element(message).toBeInTheDocument()
    expect(message.element().closest('[aria-hidden="true"]')).not.toBeNull()

    await expect.element(message).not.toBeInTheDocument()
  })

  it('renders nothing when mounted closed', async () => {
    const screen = await render(
      <Reveal open={false}>
        <p>hidden</p>
      </Reveal>,
    )
    expect(screen.getByText('hidden').elements()).toHaveLength(0)
  })
})
