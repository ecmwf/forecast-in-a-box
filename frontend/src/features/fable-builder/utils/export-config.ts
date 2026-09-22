/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import type { FableBuilderV1 } from '@/api/types/fable.types'
import { formatInZone, getAppTimeZone } from '@/lib/datetime'

/** Download a configuration as JSON — round-trips through "Load Config". */
export function downloadFableJson(fable: FableBuilderV1, name: string): void {
  const json = JSON.stringify(fable, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const date = formatInZone(
    new Date(),
    getAppTimeZone(),
    "yyyy-MM-dd'T'HH-mm-ss",
  )
  a.download = `${name.replace(/\s+/g, '_').toLowerCase()}_${date}_config.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
