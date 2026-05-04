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
import { FileText } from 'lucide-react'
import { downloadAction } from '../actions/download'
import { PdfThumbnail } from '../viewers/PdfThumbnail'
import type { OutputAdapter } from '../types'

export const pdfAdapter: OutputAdapter = {
  id: 'pdf',
  // Backend emits `image/pdf`; standard is `application/pdf`. Accept both.
  mimeTypes: ['image/pdf', 'application/pdf'],
  icon: FileText,
  label: (t) => t('outputs.adapters.pdf.label'),
  shortLabel: () => 'PDF',
  chipClass: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  extension: 'pdf',
  Thumbnail: PdfThumbnail,
  Viewer: lazy(() => import('../viewers/PdfViewer')),
  actions: [downloadAction],
}
