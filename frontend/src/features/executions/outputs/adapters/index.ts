/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * Side-effect import: registers all first-party adapters into the registry.
 * Imported once from OutputsView so the registry is populated by the time
 * the panel mounts.
 */

import { registerFirstPartySniffers } from '../firstPartySniffers'
import { registerOutputAdapter } from '../registry'
import { imageRasterAdapter } from './image'
import { imageVectorAdapter } from './svg'
import { pdfAdapter } from './pdf'

let registered = false

export function registerFirstPartyAdapters(): void {
  if (registered) return
  registered = true
  registerOutputAdapter(imageRasterAdapter)
  registerOutputAdapter(imageVectorAdapter)
  registerOutputAdapter(pdfAdapter)
  registerFirstPartySniffers()
}
