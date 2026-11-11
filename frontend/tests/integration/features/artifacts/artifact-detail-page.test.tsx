/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** The model detail header shows the catalogue facts as labelled values. */

import { describe, expect, it } from 'vitest'
import { renderWithRouter } from '@tests/utils/render'
import type { MlModelDetail, QubeNode } from '@/api/types/artifacts.types'
import { ArtifactDetailPage } from '@/features/artifacts/components/ArtifactDetailPage'

const emptyQube: QubeNode = {
  key: 'root',
  values: { type: 'enum', dtype: 'str', values: [] },
  metadata: {},
  children: [],
}

const detail = (overrides: Partial<MlModelDetail> = {}): MlModelDetail => ({
  composite_id: { artifact_store_id: 'ecmwf', artifact_local_id: 'bris' },
  display_name: 'BRIS Europe',
  display_author: 'MET Norway',
  disk_size_bytes: 1_000_000_000,
  supported_platforms: ['linux', 'macos'],
  tags: { status: 'demo', resolution: 'o96', ensemble: null },
  is_available: false,
  is_locally_compatible: true,
  local_compatibility_detail: null,
  display_description: '',
  url: '',
  pip_package_constraints: [],
  input_qube: emptyQube,
  output_qube: emptyQube,
  input_characteristics: [],
  ...overrides,
})

const renderDetail = (
  props: Partial<Parameters<typeof ArtifactDetailPage>[0]>,
) =>
  renderWithRouter(
    <ArtifactDetailPage
      detail={detail()}
      onDownload={() => {}}
      onDelete={() => {}}
      {...props}
    />,
  )

describe('ArtifactDetailPage header', () => {
  it('shows maturity, size, platforms and availability as labelled values', async () => {
    const screen = await renderDetail({})

    for (const [label, value] of [
      ['Maturity', 'demo'],
      ['Size', '953.7 MB'],
      ['Supported platforms', 'linux, macos'],
      ['Availability', 'Available'],
    ]) {
      await expect
        .element(screen.getByText(label, { exact: true }))
        .toBeVisible()
      await expect
        .element(screen.getByText(value, { exact: true }))
        .toBeVisible()
    }
    // The other tags stay chips; maturity and compatibility do not.
    await expect.element(screen.getByText('resolution: o96')).toBeVisible()
    await expect
      .element(screen.getByText('ensemble', { exact: true }))
      .toBeVisible()
    expect(screen.getByText(/^(status|maturity):/).elements()).toHaveLength(0)
    expect(
      screen.getByText('Compatible', { exact: true }).elements(),
    ).toHaveLength(0)
  })

  it('leaves out facts the catalogue does not give', async () => {
    const screen = await renderDetail({
      detail: detail({ tags: {}, disk_size_bytes: 0, supported_platforms: [] }),
    })

    await expect
      .element(screen.getByText('Availability', { exact: true }))
      .toBeVisible()
    for (const label of ['Maturity', 'Size', 'Supported platforms']) {
      expect(screen.getByText(label, { exact: true }).elements()).toHaveLength(
        0,
      )
    }
  })

  it('says Incompatible and keeps the full reason below', async () => {
    const screen = await renderDetail({
      detail: detail({
        is_locally_compatible: false,
        local_compatibility_detail: 'No GPU on this host.',
      }),
    })

    await expect
      .element(screen.getByText('Incompatible', { exact: true }))
      .toBeVisible()
    await expect
      .element(screen.getByText('Incompatible: No GPU on this host.'))
      .toBeVisible()
  })

  it('shows download progress as the availability', async () => {
    const screen = await renderDetail({
      isDownloading: true,
      downloadProgress: 42.4,
    })

    await expect
      .element(screen.getByText('Downloading 42%', { exact: true }))
      .toBeVisible()
  })
})
