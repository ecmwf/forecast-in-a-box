/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_PROJECTION_ID } from '../projection-ids'
import { PROJECTIONS } from '../projections'
import { supportsCrs } from '../wms-capabilities'
import { GLOBE_ENGINE } from '../globe/engine-entry'
import type { LensSource } from '../hooks/useLensSource'
import type { ProjectionId } from '../projection-ids'
import type { GlobeViewer } from '../globe/useGlobeViewer'
import type { ProjectionOption } from './GeoToolbar'
import type { CompareMode } from './types'
import type { SourceSlot } from './layer-pairing'
import { showToast } from '@/lib/toast'

/** The projections every source serves, a snap-back when one drops out, and the P key's cycle. */
export function useProjectionOptions({
  sourceA,
  sourceB,
  aLabel,
  bLabel,
  globe,
  focusSlot,
  mode,
  projectionId,
  changeProjection,
}: {
  sourceA: LensSource
  sourceB: LensSource
  aLabel: string
  bLabel: string | null
  globe: GlobeViewer
  focusSlot: SourceSlot | null
  mode: CompareMode
  projectionId: ProjectionId
  changeProjection: (id: ProjectionId) => void
}): {
  projectionOptions: ReadonlyArray<ProjectionOption>
  cycleProjection: () => void
} {
  const { t } = useTranslation('visualise')
  const hasB = bLabel !== null
  // Offered only when every loaded source advertises the CRS.
  const projectionOptions = useMemo<ReadonlyArray<ProjectionOption>>(() => {
    const sources = [
      { src: sourceA, label: `A · ${aLabel}` },
      ...(bLabel !== null ? [{ src: sourceB, label: `B · ${bLabel}` }] : []),
    ]
    const lacking = (code: string) =>
      sources.find(
        ({ src }) =>
          !src.loadingLayers &&
          src.error === null &&
          !supportsCrs(src.crs, code),
      )?.label ?? null
    const flat: Array<ProjectionOption> = PROJECTIONS.map((p) => ({
      id: p.id,
      labelKey: p.labelKey,
      // Mercator is never blocked: every server answers it in practice.
      blockedBy: p.id === DEFAULT_PROJECTION_ID ? null : lacking(p.code),
    }))
    if (!globe.available) return flat
    // The globe shows one source, or two side by side.
    const crsBlock = lacking(GLOBE_ENGINE.requiredCrs)
    const modeBlock = hasB && focusSlot === null && mode !== 'side'
    return [
      ...flat,
      {
        id: 'globe',
        labelKey: 'projections.globe',
        blockedBy:
          crsBlock ?? (modeBlock ? t('projections.blockedMode') : null),
        blockedReason: crsBlock ? 'crs' : modeBlock ? 'mode' : undefined,
      },
    ]
    // Keyed on the meaningful bits — the source objects churn every render.
  }, [
    sourceA.crs,
    sourceA.loadingLayers,
    sourceA.error,
    sourceB.crs,
    sourceB.loadingLayers,
    sourceB.error,
    aLabel,
    bLabel,
    globe.available,
    hasB,
    focusSlot,
    mode,
    t,
  ])
  // Snap back when a source lacks the CRS or the layout cannot show the globe.
  const { leave: leaveGlobe, exitTarget: globeExitTarget } = globe
  useEffect(() => {
    if (projectionId === 'globe') {
      if (globe.phase !== 'globe') return
      const current = projectionOptions.find((p) => p.id === 'globe')
      if (!current) return leaveGlobe(DEFAULT_PROJECTION_ID, true)
      if (!current.blockedBy) return
      if (current.blockedReason === 'mode') {
        showToast.info(t('projections.snappedBackMode'))
        return leaveGlobe(globeExitTarget)
      }
      showToast.info(
        t('projections.snappedBack', {
          source: current.blockedBy,
          projection: t(current.labelKey),
        }),
      )
      return leaveGlobe(DEFAULT_PROJECTION_ID)
    }
    const current = projectionOptions.find((p) => p.id === projectionId)
    if (!current?.blockedBy) return
    showToast.info(
      t('projections.snappedBack', {
        source: current.blockedBy,
        projection: t(current.labelKey),
      }),
    )
    changeProjection(DEFAULT_PROJECTION_ID)
  }, [
    projectionOptions,
    projectionId,
    changeProjection,
    t,
    globe.phase,
    leaveGlobe,
    globeExitTarget,
  ])
  const cycleProjection = useCallback(() => {
    const open = projectionOptions.filter((p) => p.blockedBy === null)
    const idx = open.findIndex((p) => p.id === projectionId)
    const next = open.at((idx + 1) % open.length)
    if (next) changeProjection(next.id)
  }, [projectionOptions, projectionId, changeProjection])

  return { projectionOptions, cycleProjection }
}
