/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Instants before a pinned run's reference time, fed to the failure log. */

import {
  RUN_DIMENSION,
  expandTimeSteps,
  parseWmsTimestamp,
} from '../wms-capabilities'
import type { LayerRequestSettings, ParsedLayer } from '../wms-capabilities'

export type EpochLayers = ReadonlyMap<number, ReadonlyArray<string>>

/** Layer names per advertised epoch that precede the layer's pinned run. */
export function beforeRunLayers(
  layers: ReadonlyArray<ParsedLayer>,
  activeOrder: ReadonlyArray<string>,
  settings: ReadonlyMap<string, LayerRequestSettings>,
): EpochLayers {
  const out = new Map<number, Array<string>>()
  for (const name of activeOrder) {
    const run = settings.get(name)?.dims?.[RUN_DIMENSION]
    const layer = layers.find((l) => l.name === name)
    if (!run || !layer?.time) continue
    const runEpoch = parseWmsTimestamp(run)
    if (!Number.isFinite(runEpoch)) continue
    for (const step of expandTimeSteps(layer.time.raw)) {
      const epoch = parseWmsTimestamp(step)
      if (!Number.isFinite(epoch) || epoch >= runEpoch) continue
      const names = out.get(epoch)
      if (names) names.push(name)
      else out.set(epoch, [name])
    }
  }
  return out
}

/** Union of two epoch → names maps. */
export function mergeEpochLayers(a: EpochLayers, b: EpochLayers): EpochLayers {
  if (b.size === 0) return a
  if (a.size === 0) return b
  const out = new Map<number, Array<string>>()
  for (const [epoch, names] of a) out.set(epoch, [...names])
  for (const [epoch, names] of b) {
    const cur = out.get(epoch)
    if (!cur) out.set(epoch, [...names])
    else for (const n of names) if (!cur.includes(n)) cur.push(n)
  }
  return out
}
