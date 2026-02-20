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
 * Dashboard Page Route
 *
 * Main dashboard showing:
 * - Welcome card with stats and quick actions
 * - Community news with latest models and forum topics
 * - Getting started section with configuration entry points
 * - Forecast journal with job history
 */

import { createFileRoute } from '@tanstack/react-router'
import {
  CommunityNewsCard,
  ConfigPresetsSection,
  ForecastJournal,
  GettingStartedSection,
  WelcomeCard,
} from '@/features/dashboard'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/uiStore'

function DashboardPage() {
  const layoutMode = useUiStore((state) => state.layoutMode)
  const dashboardVariant = useUiStore((state) => state.dashboardVariant)
  const panelShadow = useUiStore((state) => state.panelShadow)

  return (
    <div
      className={cn(
        'mx-auto space-y-8 px-4 py-8 sm:px-6 lg:px-8',
        layoutMode === 'boxed' ? 'max-w-7xl' : 'max-w-none',
      )}
    >
      {/* Row 1: Welcome + Community News */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <WelcomeCard variant={dashboardVariant} shadow={panelShadow} />
        <CommunityNewsCard variant={dashboardVariant} shadow={panelShadow} />
      </div>

      {/* Row 2: Getting Started */}
      <GettingStartedSection variant={dashboardVariant} shadow={panelShadow} />

      {/* Row 3: My Configuration Presets */}
      <ConfigPresetsSection variant={dashboardVariant} shadow={panelShadow} />

      {/* Row 4: Forecast Journal */}
      <ForecastJournal variant={dashboardVariant} shadow={panelShadow} />
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/dashboard')({
  component: DashboardPage,
})
