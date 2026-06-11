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
 * Presets Layout Route
 *
 * Wraps the two presets sub-routes with a shared tab navigation:
 *   /presets/gallery  — Templates (PresetGalleryPage)
 *   /presets/mine     — My Configurations (PresetsPage)
 *
 * Navigating to /presets redirects to /presets/gallery (the default tab).
 *
 * The tab strip sits above the child page's own ListPageContainer so there
 * is no double-wrapping of the horizontal padding / max-width constraints.
 */

import { Link, Outlet, createFileRoute } from '@tanstack/react-router'
import { Bookmark, LayoutGrid } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/presets')({
  component: PresetsLayout,
})

// ---------------------------------------------------------------------------
// Tab navigation
// ---------------------------------------------------------------------------

const tabClass = cn(
  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors',
  'hover:bg-background/50',
  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
)

const activeTabClass = 'bg-background text-foreground shadow-sm hover:bg-background'

function PresetsTabs() {
  const { t } = useTranslation('dashboard')
  const layoutMode = useUiStore((state) => state.layoutMode)

  return (
    // Mirror the horizontal constraints of ListPageContainer so the tabs
    // align with the page content below them.
    <div
      className={cn(
        'mx-auto px-4 pt-8 sm:px-6 lg:px-8',
        layoutMode === 'boxed' ? 'max-w-7xl' : 'max-w-none',
      )}
    >
      <nav
        aria-label={t('presets.tabs.label')}
        className="inline-flex h-9 items-center gap-1 rounded-lg bg-muted p-1"
      >
        <Link
          to="/presets/gallery"
          activeOptions={{ includeSearch: false }}
          className={tabClass}
          activeProps={{ className: activeTabClass, 'aria-current': 'page' }}
        >
          <LayoutGrid className="h-4 w-4" />
          {t('presets.tabs.templates')}
        </Link>
        <Link
          to="/presets/mine"
          activeOptions={{ includeSearch: false }}
          className={tabClass}
          activeProps={{ className: activeTabClass, 'aria-current': 'page' }}
        >
          <Bookmark className="h-4 w-4" />
          {t('presets.tabs.myConfigurations')}
        </Link>
      </nav>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Layout component
// ---------------------------------------------------------------------------

function PresetsLayout() {
  return (
    <div>
      {/* Shared tab strip — child pages manage their own ListPageContainer */}
      <PresetsTabs />
      <Outlet />
    </div>
  )
}
