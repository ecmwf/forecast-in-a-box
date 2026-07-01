/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  CalendarClock,
  Check,
  ChevronDown,
  Download,
  MoreVertical,
  Play,
  Redo2,
  Save,
  Share2,
  Undo2,
  Upload,
} from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ValidationStatusBadge } from './shared/ValidationStatus'
import { DraftStatus } from './DraftStatus'
import { GraphOptionsDropdown } from './graph-mode/GraphOptionsDropdown'
import { SaveConfigPopover } from './SaveConfigPopover'
import type {
  BlockFactoryCatalogue,
  FableBuilderV1,
} from '@/api/types/fable.types'
import { getBlocksByKind } from '@/api/types/fable.types'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { useUndoRedoShortcuts } from '@/features/fable-builder/hooks/useUndoRedoShortcuts'
import { formatInZone, getAppTimeZone } from '@/lib/datetime'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { H1 } from '@/components/base/typography'
import { copyToClipboard } from '@/lib/utils'
import { showToast } from '@/lib/toast'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface FableBuilderHeaderProps {
  fableId?: string
  catalogue: BlockFactoryCatalogue
}

export function FableBuilderHeader({
  fableId,
  catalogue,
}: FableBuilderHeaderProps) {
  const { t } = useTranslation('configure')
  const [shareButtonText, setShareButtonText] = useState(() =>
    t('header.share'),
  )
  const [savePopoverOpen, setSavePopoverOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const shareTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(shareTimeoutRef.current), [])

  const step = useFableBuilderStore((s) => s.step)
  const fableName = useFableBuilderStore((s) => s.fableName)
  // Fall back to a translated placeholder when the config is still unnamed.
  const displayName = fableName || t('page.untitledConfiguration')
  const fable = useFableBuilderStore((s) => s.fable)
  const validationState = useFableBuilderStore((s) => s.validationState)
  const storeFableId = useFableBuilderStore((s) => s.fableId)

  const setStep = useFableBuilderStore((s) => s.setStep)
  const setFable = useFableBuilderStore((s) => s.setFable)
  const setSubmitDialogOpen = useFableBuilderStore((s) => s.setSubmitDialogOpen)
  const undo = useFableBuilderStore((s) => s.undo)
  const redo = useFableBuilderStore((s) => s.redo)
  const canUndo = useFableBuilderStore((s) => s.past.length > 0)
  const canRedo = useFableBuilderStore((s) => s.future.length > 0)

  // Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z (Ctrl+Y on Windows) only while editing —
  // the review step is read-only, undo there would be misleading.
  useUndoRedoShortcuts(step === 'edit')

  const blockCount = Object.keys(fable.blocks).length
  const isValid = validationState?.isValid ?? false
  const hasBlocks = blockCount > 0
  const isExistingConfig = !!(fableId || storeFableId)
  const hasSinkBlock = getBlocksByKind(fable, catalogue, 'sink').length > 0
  const canReview = isValid && hasSinkBlock

  const reviewTooltip = !hasBlocks
    ? t('header.reviewTooltipNoBlocks')
    : !hasSinkBlock
      ? t('header.reviewTooltipNoSink')
      : !isValid
        ? t('header.reviewTooltipInvalid')
        : undefined

  async function handleShare(): Promise<void> {
    const ok = await copyToClipboard(window.location.href)
    if (!ok) {
      showToast.error(t('header.shareFailed'))
      return
    }
    setShareButtonText(t('header.shareCopied'))
    clearTimeout(shareTimeoutRef.current)
    shareTimeoutRef.current = setTimeout(
      () => setShareButtonText(t('header.share')),
      2000,
    )
  }

  function handleReview(): void {
    setStep('review')
  }

  function handleRunOnce(): void {
    // Skip the review page — submit straight from the canvas.
    setSubmitDialogOpen(true, 'run')
  }

  function handleSchedule(): void {
    setSubmitDialogOpen(true, 'schedule')
  }

  function handleBackToEdit(): void {
    setStep('edit')
  }

  function handleExportConfig(): void {
    try {
      const json = JSON.stringify(fable, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const date = formatInZone(
        new Date(),
        getAppTimeZone(),
        "yyyy-MM-dd'T'HH-mm-ss",
      )
      a.download = `${displayName.replace(/\s+/g, '_').toLowerCase()}_${date}_config.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      showToast.error(
        t('header.exportFailed'),
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  function handleLoadConfig(): void {
    fileInputRef.current?.click()
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0]
    if (!file) return

    // Prevent client-side DoS from oversized files (1 MB limit)
    const MAX_CONFIG_SIZE = 1 * 1024 * 1024
    if (file.size > MAX_CONFIG_SIZE) {
      showToast.error(
        t('header.fileTooLargeTitle'),
        t('header.fileTooLargeDescription'),
      )
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string
        const parsed = JSON.parse(content) as unknown
        if (
          parsed &&
          typeof parsed === 'object' &&
          'blocks' in parsed &&
          typeof parsed.blocks === 'object'
        ) {
          setFable(parsed as FableBuilderV1, null)
          showToast.success(t('header.configLoaded'))
        } else {
          showToast.error(
            t('header.invalidConfigTitle'),
            t('header.invalidConfigDescription'),
          )
        }
      } catch (error) {
        showToast.error(
          t('header.parseFailed'),
          error instanceof Error ? error.message : String(error),
        )
      }
    }
    reader.onerror = () => {
      showToast.error(
        t('header.readFailed'),
        reader.error?.message ?? t('header.readUnknownError'),
      )
    }
    reader.readAsText(file)

    // Reset input so same file can be loaded again
    event.target.value = ''
  }

  return (
    <>
      {/* Hidden file input for loading config */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleFileChange}
        className="hidden"
      />

      <header className="w-full overflow-hidden border-b border-border bg-card px-4 py-3">
        <div className="grid grid-cols-[1fr_auto] items-center gap-2 sm:gap-4">
          {/* Left: Back button + title */}
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Link to="/dashboard">
              <Button variant="ghost" size="icon" className="shrink-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>

            <div className="min-w-0 overflow-hidden">
              <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                <H1 className="min-w-0 truncate text-lg font-semibold">
                  {displayName}
                </H1>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{t('blockCount', { count: blockCount })}</span>
                {hasBlocks && <ValidationStatusBadge />}
                <DraftStatus className="hidden sm:inline-flex" />
              </div>
            </div>
          </div>

          {/* Right: Action buttons */}
          <div className="flex shrink-0 items-center justify-end gap-2">
            {step === 'edit' ? (
              <>
                {/* Desktop: Show main buttons */}
                <div className="hidden items-center gap-2 sm:flex">
                  {/* Graph options + undo/redo. Shortcuts in useUndoRedoShortcuts. */}
                  <div className="flex items-center gap-1">
                    <GraphOptionsDropdown />
                    <Tooltip>
                      <TooltipTrigger render={<span className="inline-flex" />}>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={undo}
                          disabled={!canUndo}
                          aria-label={t('header.undo')}
                        >
                          <Undo2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('header.undo')}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger render={<span className="inline-flex" />}>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={redo}
                          disabled={!canRedo}
                          aria-label={t('header.redo')}
                        >
                          <Redo2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('header.redo')}</TooltipContent>
                    </Tooltip>
                  </div>

                  {/* Save Config with dropdown for more actions */}
                  <ButtonGroup>
                    <SaveConfigPopover
                      fableId={fableId}
                      catalogue={catalogue}
                      disabled={!hasBlocks}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 border-l-0"
                          />
                        }
                      >
                        <MoreVertical className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-37.5">
                        <DropdownMenuItem
                          onClick={handleShare}
                          disabled={!hasBlocks}
                        >
                          <Share2 className="mr-2 h-4 w-4 shrink-0" />
                          <span className="whitespace-nowrap">
                            {shareButtonText}
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={handleExportConfig}
                          disabled={!hasBlocks}
                        >
                          <Download className="mr-2 h-4 w-4 shrink-0" />
                          <span className="whitespace-nowrap">
                            {t('header.exportConfig')}
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleLoadConfig}>
                          <Upload className="mr-2 h-4 w-4 shrink-0" />
                          <span className="whitespace-nowrap">
                            {t('header.loadConfig')}
                          </span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </ButtonGroup>

                  {/* Primary runs once (skipping review); caret holds the
                      review/schedule paths. Tooltip wraps the whole group, not
                      the button: disabled buttons swallow hover, and a
                      per-button trigger would break ButtonGroup's join. */}
                  <Tooltip>
                    <TooltipTrigger render={<span className="inline-flex" />}>
                      <ButtonGroup>
                        <Button
                          size="sm"
                          onClick={handleRunOnce}
                          disabled={!canReview}
                          className="gap-2"
                        >
                          <Play className="h-4 w-4" />
                          {t('header.runOnce')}
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                size="sm"
                                disabled={!canReview}
                                aria-label={t('header.submitOptions')}
                                className="px-1.5"
                              />
                            }
                          >
                            <ChevronDown className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-44">
                            <DropdownMenuItem onClick={handleReview}>
                              <Check className="mr-2 h-4 w-4 shrink-0" />
                              <span className="whitespace-nowrap">
                                {t('header.reviewSubmit')}
                              </span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={handleSchedule}>
                              <CalendarClock className="mr-2 h-4 w-4 shrink-0" />
                              <span className="whitespace-nowrap">
                                {t('header.runOnSchedule')}
                              </span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </ButtonGroup>
                    </TooltipTrigger>
                    {reviewTooltip && (
                      <TooltipContent>{reviewTooltip}</TooltipContent>
                    )}
                  </Tooltip>
                </div>

                {/* Mobile: Dropdown menu for all actions */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 sm:hidden"
                      />
                    }
                  >
                    <MoreVertical className="h-4 w-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-40">
                    <DropdownMenuItem
                      onClick={handleShare}
                      disabled={!hasBlocks}
                    >
                      <Share2 className="mr-2 h-4 w-4 shrink-0" />
                      <span className="whitespace-nowrap">
                        {shareButtonText}
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleExportConfig}
                      disabled={!hasBlocks}
                    >
                      <Download className="mr-2 h-4 w-4 shrink-0" />
                      <span className="whitespace-nowrap">
                        {t('header.exportConfig')}
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleLoadConfig}>
                      <Upload className="mr-2 h-4 w-4 shrink-0" />
                      <span className="whitespace-nowrap">
                        {t('header.loadConfig')}
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setSavePopoverOpen(true)}
                      disabled={!hasBlocks}
                    >
                      <Save className="mr-2 h-4 w-4 shrink-0" />
                      <span className="whitespace-nowrap">
                        {isExistingConfig
                          ? t('save.triggerUpdate')
                          : t('save.triggerSave')}
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleRunOnce}
                      disabled={!canReview}
                    >
                      <Play className="mr-2 h-4 w-4 shrink-0" />
                      <span className="whitespace-nowrap">
                        {t('header.runOnce')}
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleReview}
                      disabled={!canReview}
                    >
                      <Check className="mr-2 h-4 w-4 shrink-0" />
                      <span className="whitespace-nowrap">
                        {t('header.reviewSubmit')}
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleSchedule}
                      disabled={!canReview}
                    >
                      <CalendarClock className="mr-2 h-4 w-4 shrink-0" />
                      <span className="whitespace-nowrap">
                        {t('header.runOnSchedule')}
                      </span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Mobile: Controlled save popover triggered from dropdown */}
                <SaveConfigPopover
                  fableId={fableId}
                  catalogue={catalogue}
                  disabled={!hasBlocks}
                  open={savePopoverOpen}
                  onOpenChange={setSavePopoverOpen}
                />
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBackToEdit}
                  className="gap-2"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span className="hidden sm:inline">
                    {t('header.backToEdit')}
                  </span>
                </Button>

                <Button
                  size="sm"
                  disabled={!isValid}
                  onClick={() => setSubmitDialogOpen(true)}
                  className="gap-2"
                >
                  <Check className="h-4 w-4" />
                  <span className="hidden sm:inline">
                    {t('header.submitJob')}
                  </span>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>
    </>
  )
}
