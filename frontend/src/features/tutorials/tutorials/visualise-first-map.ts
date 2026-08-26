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
 * "Visualise forecasts on a map" — empty /visualise page to a two-provider
 * comparison on canonical sources (ECMWF, then DWD), so every user sees the
 * same tour. The only module that knows both the engine and the page.
 */

import { useEffect, useMemo, useState } from 'react'
import { TOUR, findTourElement, tourActionSelector } from '../anchors'
import type { AdvanceWhen, TutorialDefinition } from '../engine/types'
import type { CuratedWmsServer } from '@/features/visualise/curated-wms'
import { SLOT_B_OFF, entryRef } from '@/features/visualise/entry-ref'
import { useCuratedWmsServers } from '@/features/visualise/curated-wms'
import { probeWmsEndpoint } from '@/features/visualise/wms-probe'
import { useComparisonStore } from '@/features/visualise/stores/comparisonStore'

/** Signals resolved at launch. */
export interface FirstMapLaunch {
  /** The tour's canonical data source — first reachable curated server. */
  server: CuratedWmsServer
}

/** The canonical tour source leads the probe order. */
const PREFERRED_SERVER_NAME = 'ECMWF'

const hasEntries = () => useComparisonStore.getState().entries.length > 0

/** Preferred server now, first reachable as probes land; frozen once added. */
export function useFirstMapLaunchContext(): FirstMapLaunch | null {
  const servers = useCuratedWmsServers()
  const ordered = useMemo(
    () => [
      ...servers.filter((s) => s.name === PREFERRED_SERVER_NAME),
      ...servers.filter((s) => s.name !== PREFERRED_SERVER_NAME),
    ],
    [servers],
  )
  const [reachable, setReachable] = useState<CuratedWmsServer | null>(null)
  useEffect(() => {
    if (hasEntries()) return
    const probe = { cancelled: false }
    void (async () => {
      for (const server of ordered) {
        const result = await probeWmsEndpoint(server.url)
        if (probe.cancelled || hasEntries()) return
        if (result.ok) {
          setReachable(server)
          return
        }
      }
    })()
    return () => {
      probe.cancelled = true
    }
  }, [ordered])
  const server = reachable ?? ordered.at(0)
  return server === undefined ? null : { server }
}

const BASKET_NON_EMPTY: AdvanceWhen = {
  kind: 'signal',
  subscribe: (onChange) => useComparisonStore.subscribe(onChange),
  check: hasEntries,
}

/** The named server's Add row in the curated list. */
const addSelector = (name: string) =>
  `[data-server=${JSON.stringify(name)}]${tourActionSelector('add')}`

/** Layer rows serving a slot, preferring time-aware ones (they animate). */
const layerRowSelector = (slot: 'a' | 'b') => [
  `[data-source-slots*="${slot}"][data-time-aware]${tourActionSelector('layer-row')}`,
  `[data-source-slots*="${slot}"]${tourActionSelector('layer-row')}`,
]

/** Slot B's fixed provider — swapped only if it already leads the tour. */
const compareServerName = (launch: FirstMapLaunch) =>
  launch.server.name === 'DWD' ? 'ECMWF' : 'DWD'

export const firstMapDefinition: TutorialDefinition<FirstMapLaunch> = {
  id: 'visualise-first-map',
  route: '/visualise',
  i18nKey: 'firstMap',
  copyValues: (launch) => ({
    server: launch.server.name,
    compareServer: compareServerName(launch),
  }),
  steps: [
    {
      // Always first — the midSession variant re-anchors to the open map.
      id: 'orient',
      anchor: TOUR.visualise.hub,
      side: 'top',
      advance: { kind: 'next-click' },
      variant: {
        whenPresent: TOUR.visualise.map,
        key: 'midSession',
        anchor: TOUR.visualise.map,
      },
    },
    {
      id: 'addServer',
      anchor: TOUR.visualise.knownWms,
      side: 'left',
      advance: BASKET_NON_EMPTY,
      showMe: (ctx) => ({
        within: TOUR.visualise.knownWms,
        selector: addSelector(ctx.launch?.server.name ?? ''),
      }),
    },
    {
      id: 'map',
      anchor: TOUR.visualise.map,
      side: 'top',
      advance: {
        kind: 'search',
        check: (search, atEntry) => search.cam !== atEntry.cam,
      },
      allowNext: true,
      // The source may have been added from inside the Add-source dialog.
      closeDialog: true,
    },
    {
      id: 'layer',
      anchor: TOUR.visualise.layerBrowser,
      side: 'left',
      advance: {
        kind: 'search',
        check: (search) => typeof search.la === 'string' && search.la !== '',
      },
      expandVia: TOUR.visualise.expandRight,
      showMe: {
        within: TOUR.visualise.layerBrowser,
        selector: layerRowSelector('a'),
      },
    },
    {
      id: 'active',
      anchor: TOUR.visualise.activeLayers,
      side: 'right',
      advance: { kind: 'next-click' },
      expandVia: TOUR.visualise.expandLeft,
    },
    {
      id: 'time',
      anchor: TOUR.visualise.timeline,
      side: 'top',
      advance: {
        kind: 'search',
        check: (search, atEntry) => search.t !== atEntry.t,
      },
      showMe: {
        within: TOUR.visualise.timeline,
        selector: tourActionSelector('time-step'),
      },
      // Safety net: a rare time-less layer would otherwise strand the step.
      variant: {
        whenPresent: TOUR.visualise.timelineStatic,
        key: 'static',
        anchor: TOUR.visualise.timelineStatic,
        advance: { kind: 'next-click' },
      },
    },
    {
      // The curated list sits in the Manage-sources dialog; Show me does both.
      id: 'compare',
      anchor: TOUR.visualise.addSource,
      side: 'bottom',
      advance: {
        kind: 'search',
        check: (search) =>
          typeof search.b === 'string' && search.b !== SLOT_B_OFF,
      },
      showMe: (ctx) => {
        const name = ctx.launch === null ? 'DWD' : compareServerName(ctx.launch)
        // Already collected (earlier run): Add is disabled; assign B directly.
        const collected = useComparisonStore
          .getState()
          .entries.find((e) => e.kind === 'wms' && e.label === name)
        if (collected !== undefined) {
          return { search: (prev) => ({ ...prev, b: entryRef(collected) }) }
        }
        const row = {
          within: TOUR.visualise.knownWms,
          selector: addSelector(name),
        }
        // Dialog already open → press the row; else open it, then press.
        return findTourElement(TOUR.visualise.knownWms) !== null
          ? row
          : { within: TOUR.visualise.addSource, then: row }
      },
    },
    {
      // Dissimilar servers auto-unlink into A|B tabs; Show me may open B first.
      id: 'layerB',
      anchor: TOUR.visualise.layerBrowser,
      side: 'left',
      advance: {
        kind: 'search',
        check: (search) => typeof search.lb === 'string' && search.lb !== '',
      },
      expandVia: TOUR.visualise.expandRight,
      closeDialog: true,
      showMe: () => {
        const row = {
          within: TOUR.visualise.layerBrowser,
          selector: layerRowSelector('b'),
        }
        const scope = findTourElement(TOUR.visualise.layerBrowser)
        return scope?.querySelector(row.selector.join(', '))
          ? row
          : {
              within: TOUR.visualise.layerBrowser,
              selector: `[data-slot-filter="b"]${tourActionSelector('slot-filter')}`,
              then: row,
            }
      },
    },
    {
      id: 'modes',
      anchor: TOUR.visualise.modeSwitcher,
      side: 'bottom',
      advance: {
        kind: 'search',
        check: (search, atEntry) => search.mode !== atEntry.mode,
      },
      allowNext: true,
      showMe: {
        within: TOUR.visualise.modeSwitcher,
        selector: `[data-mode="swipe"]${tourActionSelector('mode')}`,
      },
    },
    {
      id: 'done',
      anchor: TOUR.visualise.help,
      side: 'bottom',
      advance: { kind: 'next-click' },
    },
  ],
}
