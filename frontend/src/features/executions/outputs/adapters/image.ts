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
import { ImageIcon } from 'lucide-react'
import { copyImageAction } from '../actions/copyImage'
import { downloadAction } from '../actions/download'
import { ImageThumbnail } from '../viewers/ImageThumbnail'
import type { OutputAdapter } from '../types'

export const imageRasterAdapter: OutputAdapter = {
  id: 'image-raster',
  mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
  icon: ImageIcon,
  label: (t) => t('outputs.adapters.image-raster.label'),
  shortLabel: () => 'PNG',
  chipClass:
    'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
  extension: 'png',
  Thumbnail: ImageThumbnail,
  Viewer: lazy(() => import('../viewers/ImageViewer')),
  actions: [copyImageAction, downloadAction],
}
