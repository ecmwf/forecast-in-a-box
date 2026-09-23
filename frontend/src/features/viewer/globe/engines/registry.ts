/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Globe engines: static gating metadata, lazily loaded implementations. */

import type { GlobeEngineCapabilities, GlobeEngineFactory } from '../engine'

export interface GlobeEngineEntry {
  /** CRS every source must advertise for the globe to be offered. */
  requiredCrs: string
  capabilities: GlobeEngineCapabilities
  load: () => Promise<GlobeEngineFactory>
}

export const GLOBE_ENGINES = {
  three: {
    requiredCrs: 'EPSG:4326',
    capabilities: {
      morphFrom: ['merc', 'geo'],
      poles: true,
      minZoom: -2,
      maxZoom: 6,
    },
    load: () =>
      import('./three/ThreeGlobeEngine').then((m) => m.createThreeGlobeEngine),
  },
} as const satisfies Record<string, GlobeEngineEntry>

export type GlobeEngineId = keyof typeof GLOBE_ENGINES

export const ACTIVE_GLOBE_ENGINE: GlobeEngineEntry = GLOBE_ENGINES.three
