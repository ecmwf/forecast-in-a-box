/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { HardDrive } from 'lucide-react'
import type { OutputAdapter } from '../types'

/**
 * GRIB sink marker outputs. The sink writes the actual GRIB file(s) to its
 * configured filesystem path and streams back only the parent directory as
 * ASCII text, tagged `text/plain; fiab-format=gribdir` (`GRIB_MIME` in the
 * ecmwf plugin). The downloadable payload is that path string — not GRIB
 * data — so the card offers no actions; the files themselves are reachable
 * through the "Stored outputs" card (WMS viewer / external WMS URL).
 */
export const gribStoredAdapter: OutputAdapter = {
  id: 'grib-stored',
  mimeTypes: ['text/plain; fiab-format=gribdir'],
  icon: HardDrive,
  label: (t) => t('outputs.adapters.grib-stored.label'),
  shortLabel: () => 'GRIB',
  chipClass:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  extension: 'grib2',
  actions: [],
}
