/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useEffect } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { decideGate } from './gating'
import { WelcomeDialog } from './components/WelcomeDialog'
import { useBlockCatalogue } from '@/api/hooks/useFable'
import { useJobStatusCounts } from '@/api/hooks/useJobStatusCounts'
import { useOnboardingStore } from '@/stores/onboardingStore'

/** Feeds live signals into the pure gate and renders the dialog when due. */
export function WelcomeGate() {
  const status = useOnboardingStore((state) => state.status)
  const welcomeOpen = useOnboardingStore((state) => state.welcomeOpen)
  const snoozedAt = useOnboardingStore((state) => state.snoozedAt)
  const frozenPluginStep = useOnboardingStore((state) => state.pluginStepNeeded)
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const catalogue = useBlockCatalogue()
  const jobs = useJobStatusCounts()

  const decision = decideGate(
    {
      status,
      welcomeOpen,
      snoozedAt,
      pathname,
      catalogueSettled: catalogue.isSuccess || catalogue.isError,
      catalogueEmpty:
        !catalogue.data || Object.keys(catalogue.data).length === 0,
      // On error the query settles with the empty default — an existing
      // user then sees one skippable dialog; accepted trade-off.
      jobsSettled: !jobs.isLoading,
      jobsTotal: jobs.total,
    },
    Date.now(),
  )

  useEffect(() => {
    if (decision.kind === 'grandfather') {
      useOnboardingStore.getState().skip()
      return
    }
    // Freeze the branch at first open so the final pane never flips mid-flow.
    if (decision.kind === 'open' && frozenPluginStep === null) {
      useOnboardingStore
        .getState()
        .setPluginStepNeeded(decision.pluginStepNeeded)
    }
  }, [decision.kind, frozenPluginStep, decision])

  if (decision.kind !== 'open') return null
  return (
    <WelcomeDialog
      pluginStepNeeded={frozenPluginStep ?? decision.pluginStepNeeded}
    />
  )
}
