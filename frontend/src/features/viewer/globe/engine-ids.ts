/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Globe engine ids, kept apart from the registry so stores stay engine-free. */

export const GLOBE_ENGINE_IDS = ['three', 'maplibre'] as const

export type GlobeEngineId = (typeof GLOBE_ENGINE_IDS)[number]

export const DEFAULT_GLOBE_ENGINE: GlobeEngineId = 'three'

export function isGlobeEngineId(value: unknown): value is GlobeEngineId {
  return (
    typeof value === 'string' &&
    (GLOBE_ENGINE_IDS as ReadonlyArray<string>).includes(value)
  )
}
