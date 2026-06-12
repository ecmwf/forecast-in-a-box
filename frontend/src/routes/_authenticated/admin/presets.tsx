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
 * Admin Presets Page Route — /admin/presets
 *
 * Lists all presets (including unpublished) in a table with per-row
 * publish/unpublish toggle and delete (with confirmation dialog).
 *
 * Access is guarded by the parent `/_authenticated/admin` layout route which
 * redirects non-superusers to /dashboard.
 *
 * Publish/unpublish toggle:
 *   Uses the dedicated `/publish` endpoint which updates `is_published`
 *   in-place without incrementing the version.  The list item already
 *   carries `preset_id`, `version`, and `is_published`, so no extra fetch
 *   is required.
 */

import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  Edit2,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Sliders,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  HighLevelPreset,
  PresetListItem,
  PresetListResponse,
} from '@/api/types/preset.types'
import { getPreset } from '@/api/endpoints/preset'
import {
  useDeletePreset,
  usePresetList,
  usePublishPreset,
} from '@/api/hooks/usePresets'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { ListPageContainer } from '@/components/common/ListPageContainer'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { showToast } from '@/lib/toast'
import { PresetFormDialog } from '@/features/admin/presets/PresetFormDialog'

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/_authenticated/admin/presets')({
  component: AdminPresetsPage,
})

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Wire-format list item as returned by the paginated list endpoint.
 * Uses the Zod-inferred type so nullable/optional fields match exactly.
 */
type PresetRow = PresetListResponse['presets'][number]

// ---------------------------------------------------------------------------
// Difficulty badge variant helper
// ---------------------------------------------------------------------------

type DifficultyVariant = 'default' | 'secondary' | 'outline'

function difficultyVariant(
  difficulty: PresetListItem['difficulty'],
): DifficultyVariant {
  switch (difficulty) {
    case 'beginner':
      return 'secondary'
    case 'intermediate':
      return 'default'
    case 'advanced':
      return 'outline'
  }
}

// ---------------------------------------------------------------------------
// Row-level publish toggle
// ---------------------------------------------------------------------------

interface PublishToggleProps {
  preset: PresetRow
}

/**
 * Calls the dedicated `/publish` endpoint to toggle `is_published` in-place.
 * No full-preset fetch is needed — the list item already carries all required
 * fields (`preset_id`, `version`, `is_published`).
 */
function PublishToggle({ preset }: PublishToggleProps) {
  const { t } = useTranslation('presets')
  const publishPreset = usePublishPreset()

  async function handleToggle() {
    const newPublished = !preset.is_published
    try {
      await publishPreset.mutateAsync({
        preset_id: preset.preset_id,
        version: preset.version,
        is_published: newPublished,
      })
      showToast.success(
        newPublished
          ? t('admin.toast.publishSuccess')
          : t('admin.toast.unpublishSuccess'),
      )
    } catch {
      showToast.error(t('admin.toast.publishError'))
    }
  }

  const isPending = publishPreset.isPending
  const isCurrentlyPublished = preset.is_published

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() => void handleToggle()}
      aria-label={
        isCurrentlyPublished
          ? t('admin.actions.unpublish')
          : t('admin.actions.publish')
      }
      title={
        isCurrentlyPublished
          ? t('admin.actions.unpublish')
          : t('admin.actions.publish')
      }
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : isCurrentlyPublished ? (
        <EyeOff className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Eye className="h-4 w-4" aria-hidden="true" />
      )}
      <span className="ml-1.5 hidden sm:inline">
        {isPending
          ? isCurrentlyPublished
            ? t('admin.actions.unpublishing')
            : t('admin.actions.publishing')
          : isCurrentlyPublished
            ? t('admin.actions.unpublish')
            : t('admin.actions.publish')}
      </span>
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Row-level edit button
// ---------------------------------------------------------------------------

interface EditButtonProps {
  preset: PresetRow
  onEdit: (preset: PresetRow) => void
}

function EditButton({ preset, onEdit }: EditButtonProps) {
  const { t } = useTranslation('presets')

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onEdit(preset)}
      aria-label={t('admin.actions.edit')}
      title={t('admin.actions.edit')}
    >
      <Edit2 className="h-4 w-4" aria-hidden="true" />
      <span className="ml-1.5 hidden sm:inline">{t('admin.actions.edit')}</span>
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Row-level delete button + confirmation dialog
// ---------------------------------------------------------------------------

interface DeleteButtonProps {
  preset: PresetRow
}

function DeleteButton({ preset }: DeleteButtonProps) {
  const { t } = useTranslation('presets')
  const deletePreset = useDeletePreset()

  const isPending = deletePreset.isPending

  async function handleDelete() {
    try {
      await deletePreset.mutateAsync({
        preset_id: preset.preset_id,
        version: preset.version,
      })
      showToast.success(t('admin.toast.deleteSuccess'))
    } catch {
      showToast.error(t('admin.toast.deleteError'))
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            aria-label={t('admin.actions.delete')}
            title={t('admin.actions.delete')}
            className="text-destructive hover:text-destructive"
          />
        }
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        )}
        <span className="ml-1.5 hidden sm:inline">
          {isPending ? t('admin.actions.deleting') : t('admin.actions.delete')}
        </span>
      </AlertDialogTrigger>

      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('admin.delete.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('admin.delete.description', { name: preset.name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('admin.delete.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => void handleDelete()}
          >
            {t('admin.delete.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ---------------------------------------------------------------------------
// Presets table
// ---------------------------------------------------------------------------

interface PresetsTableProps {
  presets: Array<PresetRow>
  onEdit: (preset: PresetRow) => void
}

function PresetsTable({ presets, onEdit }: PresetsTableProps) {
  const { t } = useTranslation('presets')

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">
              {t('admin.table.name')}
            </th>
            <th className="hidden px-4 py-3 text-left font-medium text-muted-foreground sm:table-cell">
              {t('admin.table.difficulty')}
            </th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">
              {t('admin.table.status')}
            </th>
            <th className="hidden px-4 py-3 text-left font-medium text-muted-foreground lg:table-cell">
              {t('admin.table.version')}
            </th>
            <th className="hidden px-4 py-3 text-left font-medium text-muted-foreground xl:table-cell">
              {t('admin.table.createdBy')}
            </th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">
              {t('admin.table.actions')}
            </th>
          </tr>
        </thead>
        <tbody>
          {presets.map((preset, idx) => (
            <tr
              key={preset.preset_id}
              className={idx % 2 === 0 ? 'bg-background' : 'bg-muted/20'}
            >
              {/* Name */}
              <td className="px-4 py-3 font-medium">{preset.name}</td>

              {/* Difficulty */}
              <td className="hidden px-4 py-3 sm:table-cell">
                <Badge variant={difficultyVariant(preset.difficulty)}>
                  {t(`admin.difficulty.${preset.difficulty}`)}
                </Badge>
              </td>

              {/* Published status */}
              <td className="px-4 py-3">
                <Badge variant={preset.is_published ? 'default' : 'outline'}>
                  {preset.is_published
                    ? t('admin.status.published')
                    : t('admin.status.unpublished')}
                </Badge>
              </td>

              {/* Version */}
              <td className="hidden px-4 py-3 font-mono text-muted-foreground lg:table-cell">
                v{preset.version}
              </td>

              {/* Created by */}
              <td className="hidden px-4 py-3 text-muted-foreground xl:table-cell">
                {preset.created_by ?? '—'}
              </td>

              {/* Actions */}
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-1">
                  <EditButton preset={preset} onEdit={onEdit} />
                  <PublishToggle preset={preset} />
                  <DeleteButton preset={preset} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

function AdminPresetsPage() {
  const { t } = useTranslation('presets')

  // Pagination state
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50

  // Form dialog state
  const [formOpen, setFormOpen] = useState(false)
  const [editingPreset, setEditingPreset] = useState<HighLevelPreset | null>(
    null,
  )
  const [loadingEditId, setLoadingEditId] = useState<string | null>(null)

  // Fetch ALL presets including unpublished (admin override).
  // The backend enforces the admin permission check for published_only=false.
  const { data, isLoading, isError, refetch } = usePresetList(
    { published_only: false },
    page,
    PAGE_SIZE,
  )

  const presets = data?.presets ?? []
  // TODO: Add server-side source=user filter to avoid client-side filtering
  const editablePresets = presets.filter((p) => p.source !== 'plugin')
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // ── Open create form ──────────────────────────────────────────────────────
  function handleCreateNew() {
    setEditingPreset(null)
    setFormOpen(true)
  }

  // ── Open edit form — fetches full preset detail on demand ─────────────────
  async function handleEdit(row: PresetRow) {
    setLoadingEditId(row.preset_id)
    try {
      const full = await getPreset(row.preset_id)
      setEditingPreset(full)
      setFormOpen(true)
    } catch {
      showToast.error(t('admin.toast.loadError'))
    } finally {
      setLoadingEditId(null)
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <ListPageContainer>
        <PageHeader
          title={t('admin.page.title')}
          description={t('admin.page.description')}
        />
        <div className="flex min-h-[300px] items-center justify-center rounded-lg border border-border">
          <EmptyState
            icon={Sliders}
            title={t('gallery.error.title')}
            description={t('gallery.error.description')}
            action={
              <Button variant="outline" onClick={() => void refetch()}>
                {t('gallery.error.title')}
              </Button>
            }
          />
        </div>
      </ListPageContainer>
    )
  }

  // ── Page ──────────────────────────────────────────────────────────────────
  return (
    <>
      <ListPageContainer>
        {/* Page header with "Create New Preset" CTA */}
        <PageHeader
          title={t('admin.page.title')}
          description={t('admin.page.description')}
          actions={
            <Button
              onClick={handleCreateNew}
              aria-label={t('admin.actions.createNew')}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t('admin.actions.createNew')}
            </Button>
          }
        />

        {/* Empty state */}
        {editablePresets.length === 0 ? (
          <div className="flex min-h-[300px] items-center justify-center rounded-lg border border-border">
            <EmptyState
              icon={Sliders}
              title={t('admin.empty.title')}
              description={t('admin.empty.description')}
              action={
                <Button onClick={handleCreateNew}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {t('admin.actions.createNew')}
                </Button>
              }
            />
          </div>
        ) : (
          <>
            {/* Summary count */}
            <p className="text-sm text-muted-foreground">
              {total} preset{total !== 1 ? 's' : ''}
            </p>

            {/* Presets table */}
            <PresetsTable
              presets={editablePresets}
              onEdit={(row) => void handleEdit(row)}
            />

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  {t('mine.pagination.previous')}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {t('mine.pagination.page', {
                    current: page,
                    total: totalPages,
                  })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  {t('mine.pagination.next')}
                </Button>
              </div>
            )}
          </>
        )}
      </ListPageContainer>

      {/* Loading overlay while fetching preset detail for edit */}
      {loadingEditId && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/10">
          <div className="flex items-center gap-2 rounded-lg bg-background px-4 py-3 shadow-lg ring-1 ring-border">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span className="text-sm">{t('form.actions.saving')}</span>
          </div>
        </div>
      )}

      {/* Create / Edit form dialog */}
      <PresetFormDialog
        preset={editingPreset}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open)
          if (!open) setEditingPreset(null)
        }}
      />
    </>
  )
}
