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
 * PresetGalleryPage
 *
 * Browsable gallery of all published high-level presets.  Provides:
 *   - Debounced free-text search (name / description / tags)
 *   - Difficulty toggle buttons (All / Beginner / Intermediate / Advanced)
 *   - Responsive card grid (1 → 2 → 3 → 4 columns)
 *   - Loading skeleton while data is in-flight
 *   - Empty state when no presets match the active filters
 *
 * Card selection behaviour (orchestrated by the parent via `onSelectPreset`):
 *   - Beginner presets → instant instantiation + navigation (no wizard)
 *   - Intermediate / advanced presets → PresetWizardDialog opens
 *
 * The wizard dialog is rendered here so it sits inside the same React tree as
 * the card grid, but all state is owned by the parent route/section via the
 * `wizardPreset`, `wizardOpen`, and `onWizardOpenChange` props.
 */

import { useMemo, useState } from 'react'
import { LayoutGrid } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePresetList } from '@/api/hooks/usePresets'
import type {
  HighLevelPreset,
  PresetDifficulty,
  PresetListItem,
  PresetListResponse,
} from '@/api/types/preset.types'
import { useDebounce } from '@/hooks/useDebounce'
import { EmptyState } from '@/components/common/EmptyState'
import { ListPageContainer } from '@/components/common/ListPageContainer'
import { PageHeader } from '@/components/common/PageHeader'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { PresetWizardDialog } from '@/features/fable-builder/components/PresetWizardDialog'
import { PresetGalleryCard } from './PresetGalleryCard'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DifficultyFilter = 'all' | PresetDifficulty

/** The element type of the paginated preset list (Zod-inferred). */
type PresetItem = PresetListResponse['presets'][number]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Typed label keys so `t(labelKey)` satisfies the strict i18n type-checker.
type DifficultyLabelKey =
  | 'presetGallery.filters.allDifficulties'
  | 'presetGallery.difficulty.beginner.name'
  | 'presetGallery.difficulty.intermediate.name'
  | 'presetGallery.difficulty.advanced.name'

const DIFFICULTY_OPTIONS: Array<{
  value: DifficultyFilter
  labelKey: DifficultyLabelKey
}> = [
  { value: 'all', labelKey: 'presetGallery.filters.allDifficulties' },
  { value: 'beginner', labelKey: 'presetGallery.difficulty.beginner.name' },
  {
    value: 'intermediate',
    labelKey: 'presetGallery.difficulty.intermediate.name',
  },
  { value: 'advanced', labelKey: 'presetGallery.difficulty.advanced.name' },
]

/** Client-side filter applied on top of the full preset list. */
function filterPresets(
  presets: ReadonlyArray<PresetItem>,
  search: string,
  difficulty: DifficultyFilter,
): Array<PresetItem> {
  const needle = search.trim().toLowerCase()

  return presets.filter((p) => {
    if (difficulty !== 'all' && p.difficulty !== difficulty) return false
    if (needle) {
      return (
        p.name.toLowerCase().includes(needle) ||
        p.description.toLowerCase().includes(needle) ||
        p.tags.some((tag: string) => tag.toLowerCase().includes(needle))
      )
    }
    return true
  })
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function GallerySkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={i} className="flex flex-col gap-3 rounded-xl border p-6">
          <div className="flex items-start gap-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          </div>
          <Skeleton className="h-14 w-full" />
          <div className="flex gap-1.5">
            <Skeleton className="h-5 w-20 rounded" />
            <Skeleton className="h-5 w-14 rounded" />
          </div>
          <Skeleton className="mt-auto h-8 w-full rounded-md" />
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface PresetGalleryPageProps {
  /**
   * Called when the user clicks "Use This Preset" on a card.
   *
   * May be async — the card will show a loading state while the promise is
   * pending.  If omitted the button is still rendered but does nothing.
   */
  onSelectPreset?: (presetId: string) => void | Promise<void>

  /**
   * The fully-fetched preset to display in the wizard dialog.
   * Pass `null` (or omit) when no wizard should be shown.
   */
  wizardPreset?: HighLevelPreset | null

  /**
   * Controls whether the wizard dialog is open.
   */
  wizardOpen?: boolean

  /**
   * Called when the wizard dialog requests an open/close state change.
   */
  onWizardOpenChange?: (open: boolean) => void
}

export function PresetGalleryPage({
  onSelectPreset,
  wizardPreset = null,
  wizardOpen = false,
  onWizardOpenChange,
}: PresetGalleryPageProps) {
  const { t } = useTranslation('dashboard')

  // ── Filter state ──────────────────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState('')
  const [selectedDifficulty, setSelectedDifficulty] =
    useState<DifficultyFilter>('all')

  // Track which preset ID is currently being actioned so the card can show a
  // loading spinner while the async handler resolves.
  const [loadingPresetId, setLoadingPresetId] = useState<string | null>(null)

  // Debounce the raw input so filtering only runs 300 ms after the user stops
  // typing, keeping the UI responsive on large lists.
  const debouncedSearch = useDebounce(searchInput, 300)

  // ── Data fetching ─────────────────────────────────────────────────────────
  // Fetch the full list without server-side filters so client-side filtering
  // is instant (no extra round-trips on every keystroke).
  const {
    data: listData,
    isLoading: isLoadingList,
    isError: isListError,
  } = usePresetList(undefined, 1, 200)

  // ── Derived data ──────────────────────────────────────────────────────────
  const allPresets = listData?.presets ?? []

  const filteredPresets = useMemo(
    () => filterPresets(allPresets, debouncedSearch, selectedDifficulty),
    [allPresets, debouncedSearch, selectedDifficulty],
  )

  const isLoading = isLoadingList
  const hasActiveFilters =
    debouncedSearch.trim() !== '' || selectedDifficulty !== 'all'

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function handleSelectPreset(presetId: string) {
    if (!onSelectPreset || loadingPresetId !== null) return
    setLoadingPresetId(presetId)
    try {
      await onSelectPreset(presetId)
    } finally {
      setLoadingPresetId(null)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <ListPageContainer>
      <PageHeader
        title={t('presetGallery.page.title')}
        description={t('presetGallery.page.description')}
      />

      {/* ── Controls bar ── */}
      <div className="flex flex-col gap-4">
        {/* Search */}
        <Input
          type="search"
          placeholder={t('presetGallery.search.placeholder')}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="max-w-sm"
          aria-label={t('presetGallery.search.ariaLabel')}
        />

        {/* Difficulty toggle buttons */}
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-label={t('presetGallery.filters.difficulty.label')}
        >
          {DIFFICULTY_OPTIONS.map(({ value, labelKey }) => (
            <button
              key={value}
              type="button"
              onClick={() => setSelectedDifficulty(value)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                selectedDifficulty === value
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
              aria-pressed={selectedDifficulty === value}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content area ── */}
      {isLoading ? (
        <GallerySkeletonGrid />
      ) : isListError ? (
        <EmptyState
          icon={LayoutGrid}
          title={t('presetGallery.empty.title')}
          description={t('presetGallery.empty.description')}
        />
      ) : filteredPresets.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title={
            hasActiveFilters
              ? t('presetGallery.empty.filteredTitle')
              : t('presetGallery.empty.title')
          }
          description={
            hasActiveFilters
              ? t('presetGallery.empty.filteredDescription')
              : t('presetGallery.empty.description')
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredPresets.map((preset) => (
            <PresetGalleryCard
              key={preset.preset_id}
              // Cast: the Zod-inferred type marks optional fields as
              // `string | null | undefined`; the PresetListItem interface
              // uses `string | null`.  The values are runtime-compatible.
              preset={preset as PresetListItem}
              onSelect={handleSelectPreset}
              builderTemplate={(preset as PresetListItem).builder_template}
              isLoading={loadingPresetId === preset.preset_id}
            />
          ))}
        </div>
      )}

      {/* ── Wizard dialog (intermediate / advanced presets) ── */}
      {wizardPreset && onWizardOpenChange && (
        <PresetWizardDialog
          preset={wizardPreset}
          open={wizardOpen}
          onOpenChange={onWizardOpenChange}
        />
      )}
    </ListPageContainer>
  )
}
