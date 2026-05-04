/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { lazy } from 'react'
import { ImagePlus } from 'lucide-react'
import { copyImageAction } from '../actions/copyImage'
import { downloadAction } from '../actions/download'
import { ImageThumbnail } from '../viewers/ImageThumbnail'
import type { OutputAdapter } from '../types'

export const imageVectorAdapter: OutputAdapter = {
  id: 'image-vector',
  // Backend emits `image/svg`; standard is `image/svg+xml`. Accept both.
  mimeTypes: ['image/svg', 'image/svg+xml'],
  icon: ImagePlus,
  label: (t) => t('outputs.adapters.image-vector.label'),
  shortLabel: () => 'SVG',
  chipClass:
    'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300',
  extension: 'svg',
  Thumbnail: ImageThumbnail,
  Viewer: lazy(() => import('../viewers/ImageViewer')),
  actions: [copyImageAction, downloadAction],
}
