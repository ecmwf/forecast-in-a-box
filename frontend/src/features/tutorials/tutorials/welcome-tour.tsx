/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Welcome tour: one step per main page, pointing at its nav tab; ends on the starters. */

import { TOUR } from '../anchors'
import { SLOT_MARKUP } from './visualise-first-map'
import type { TutorialDefinition } from '../engine/types'
import { BLOCK_KIND_METADATA } from '@/api/types/fable.types'
import { useOnboardingStore } from '@/stores/onboardingStore'

/** Nothing to resolve; stable object avoids re-renders. */
const LAUNCH = {}
export const useWelcomeTourLaunchContext = () => LAUNCH

/** Block-kind words in the copy carry the canvas' kind colours; `<source>`
 * is an HTML void tag, hence the `kind` prefix. */
const KIND_MARKUP = Object.fromEntries(
  Object.values(BLOCK_KIND_METADATA).map((meta) => [
    `kind${meta.kind[0].toUpperCase()}${meta.kind.slice(1)}`,
    <span className={`font-medium ${meta.color}`} />,
  ]),
)

export const welcomeTourDefinition: TutorialDefinition<typeof LAUNCH> = {
  id: 'welcome-tour',
  route: '/overview',
  i18nKey: 'welcome',
  markup: { ...KIND_MARKUP, ...SLOT_MARKUP },
  // Completing the tour counts as onboarded: no auto-reshow.
  onFinish: (outcome) => {
    if (outcome === 'completed') useOnboardingStore.getState().startForecast()
  },
  steps: [
    {
      id: 'dashboard',
      route: '/overview',
      anchor: TOUR.nav.overview,
      side: 'bottom',
      align: 'start',
      advance: { kind: 'next-click' },
    },
    {
      id: 'blocks',
      route: '/configure',
      anchor: TOUR.nav.configure,
      side: 'bottom',
      align: 'start',
      advance: { kind: 'next-click' },
    },
    {
      id: 'execution',
      route: '/execute',
      anchor: TOUR.nav.execute,
      side: 'bottom',
      align: 'start',
      advance: { kind: 'next-click' },
    },
    {
      id: 'viewer',
      route: '/visualise',
      anchor: TOUR.nav.visualise,
      side: 'bottom',
      align: 'start',
      advance: { kind: 'next-click' },
    },
    {
      // A starter pick opens Configure and completes the tour.
      id: 'activate',
      route: '/overview',
      anchor: TOUR.overview.starters,
      side: 'top',
      advance: {
        kind: 'route',
        match: (pathname) => pathname.startsWith('/configure'),
      },
      allowNext: true,
      spotlightPadding: 2,
    },
  ],
}
