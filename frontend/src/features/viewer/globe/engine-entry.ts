/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** The globe engine: static gating metadata, lazily loaded implementation. */

import type { GlobeEngineFactory } from './engine'

export const GLOBE_ENGINE = {
  /** CRS every source must advertise for the globe to be offered. */
  requiredCrs: 'EPSG:4326',
  /** Neutral zoom ceiling; the ~1 deg sphere mesh stays within a pixel of true up to here. */
  maxZoom: 8,
  load: (): Promise<GlobeEngineFactory> =>
    import('./MapLibreGlobeEngine').then((m) => m.createMapLibreGlobeEngine),
}
