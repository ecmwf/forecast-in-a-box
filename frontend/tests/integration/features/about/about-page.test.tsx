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
import { renderWithRouter } from '@tests/utils/render'
import { AboutPage } from '@/features/about/components/AboutPage'

describe('AboutPage', () => {
  it('lists every partner', async () => {
    const screen = await renderWithRouter(<AboutPage />)

    // FMI ships a light and a dark logo; only CSS hides one of them.
    for (const name of ['ECMWF', 'MetNorway', 'FMI', 'DestinE']) {
      await expect
        .element(screen.getByRole('img', { name, exact: true }).first())
        .toBeInTheDocument()
    }
    await expect
      .element(screen.getByRole('link', { name: /ArcX/ }))
      .toHaveAttribute(
        'href',
        'https://africa-knowledge-platform.ec.europa.eu/arcx',
      )
  })
})
