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
import { CoreVersionMismatchBadge } from '@/components/common/CoreVersionMismatchBadge'
// Initialise i18next so the badge's t() calls resolve to real strings.
import '@/lib/i18n'

describe('CoreVersionMismatchBadge', () => {
  it('renders the warning label for a backend mismatch value', async () => {
    const screen = await render(<CoreVersionMismatchBadge detail="!3 != 4" />)
    await expect
      .element(screen.getByText('Core version mismatch'))
      .toBeVisible()
  })

  it('renders for an unparseable detail without throwing', async () => {
    const screen = await render(<CoreVersionMismatchBadge detail="garbage" />)
    await expect
      .element(screen.getByText('Core version mismatch'))
      .toBeVisible()
  })
})
