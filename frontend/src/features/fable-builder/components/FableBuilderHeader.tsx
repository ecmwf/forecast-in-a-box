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
  Check,
  Download,
  FileText,
  LayoutGrid,
  MoreVertical,
  Save,
  Share2,
  Upload,
} from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { ValidationStatusBadge } from './shared/ValidationStatus'
import { GraphOptionsDropdown } from './graph-mode/GraphOptionsDropdown'
import { SaveConfigPopover } from './SaveConfigPopover'
import type {
  BlockFactoryCatalogue,
  FableBuilderV1,
} from '@/api/types/fable.types'
import { getBlocksByKind } from '@/api/types/fable.types'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { H1 } from '@/components/base/typography'
import { cn } from '@/lib/utils'
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
  const [shareButtonText, setShareButtonText] = useState('Share')
  const [savePopoverOpen, setSavePopoverOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const shareTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(shareTimeoutRef.current), [])

  const mode = useFableBuilderStore((s) => s.mode)
  const step = useFableBuilderStore((s) => s.step)
  const fableName = useFableBuilderStore((s) => s.fableName)
  const fable = useFableBuilderStore((s) => s.fable)
  const isDirty = useFableBuilderStore((s) => s.isDirty)
  const validationState = useFableBuilderStore((s) => s.validationState)
  const storeFableId = useFableBuilderStore((s) => s.fableId)

  const setMode = useFableBuilderStore((s) => s.setMode)
  const setStep = useFableBuilderStore((s) => s.setStep)
  const setFable = useFableBuilderStore((s) => s.setFable)

  const blockCount = Object.keys(fable.blocks).length
  const isValid = validationState?.isValid ?? false
  const hasBlocks = blockCount > 0
  const isExistingConfig = !!(fableId || storeFableId)
  const hasSinkBlock = getBlocksByKind(fable, catalogue, 'sink').length > 0
  const canReview = isValid && hasSinkBlock

  const reviewTooltip = !hasBlocks
    ? 'Add blocks to your configuration'
    : !hasSinkBlock
      ? 'Add at least one output block'
      : !isValid
        ? 'Fix validation errors before submitting'
        : undefined

  function handleShare(): void {
    navigator.clipboard.writeText(window.location.href)
    setShareButtonText('Copied!')
    clearTimeout(shareTimeoutRef.current)
    shareTimeoutRef.current = setTimeout(
      () => setShareButtonText('Share'),
      2000,
    )
  }

  function handleReview(): void {
    setStep('review')
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
      const date = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
      a.download = `${fableName.replace(/\s+/g, '_').toLowerCase()}_${date}_config.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      showToast.error(
        'Failed to export config',
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

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string
        const parsed = JSON.parse(content) as unknown
        if (
          parsed &&
          typeof parsed === 'object' &&
          'blocks' in parsed &&
          typeof (parsed as { blocks: unknown }).blocks === 'object'
        ) {
          setFable(parsed as FableBuilderV1, null)
          showToast.success('Configuration loaded')
        } else {
          showToast.error(
            'Invalid config file',
            'File must contain a valid configuration with a "blocks" property.',
          )
        }
      } catch (error) {
        showToast.error(
          'Failed to parse config file',
          error instanceof Error ? error.message : String(error),
        )
      }
    }
    reader.onerror = () => {
      showToast.error(
        'Failed to read file',
        reader.error?.message ?? 'Unknown read error',
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
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-4">
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
                  {fableName}
                </H1>
                {isDirty && (
                  <Badge
                    variant="outline"
                    className="hidden shrink-0 text-sm sm:inline-flex"
                  >
                    Unsaved
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>
                  {blockCount} {blockCount === 1 ? 'block' : 'blocks'}
                </span>
                {hasBlocks && <ValidationStatusBadge />}
              </div>
            </div>
          </div>

          {/* Center: Mode toggle (Graph/Form) */}
          <div className="flex justify-center">
            {step === 'edit' && (
              <div className="flex shrink-0 items-center gap-1 rounded-lg bg-muted p-1">
                {mode === 'graph' ? (
                  <ButtonGroup>
                    <Button
                      variant="default"
                      size="sm"
                      className="gap-1.5 shadow-sm sm:gap-2"
                    >
                      <LayoutGrid className="h-4 w-4" />
                      <span className="hidden sm:inline">Graph</span>
                    </Button>
                    <GraphOptionsDropdown />
                  </ButtonGroup>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setMode('graph')}
                    className="gap-1.5 sm:gap-2"
                  >
                    <LayoutGrid className="h-4 w-4" />
                    <span className="hidden sm:inline">Graph</span>
                  </Button>
                )}
                <Button
                  variant={mode === 'form' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setMode('form')}
                  className={cn(
                    'gap-1.5 sm:gap-2',
                    mode === 'form' && 'shadow-sm',
                  )}
                >
                  <FileText className="h-4 w-4" />
                  <span className="hidden sm:inline">Form</span>
                </Button>
              </div>
            )}
          </div>

          {/* Right: Action buttons */}
          <div className="flex shrink-0 items-center justify-end gap-2">
            {step === 'edit' ? (
              <>
                {/* Desktop: Show main buttons */}
                <div className="hidden items-center gap-2 sm:flex">
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
                            Export Config
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleLoadConfig}>
                          <Upload className="mr-2 h-4 w-4 shrink-0" />
                          <span className="whitespace-nowrap">Load Config</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </ButtonGroup>

                  <Tooltip>
                    <TooltipTrigger render={<span className="inline-flex" />}>
                      <Button
                        size="sm"
                        onClick={handleReview}
                        disabled={!canReview}
                        className="gap-2"
                      >
                        <Check className="h-4 w-4" />
                        Review & Submit
                      </Button>
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
                      <span className="whitespace-nowrap">Export Config</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleLoadConfig}>
                      <Upload className="mr-2 h-4 w-4 shrink-0" />
                      <span className="whitespace-nowrap">Load Config</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setSavePopoverOpen(true)}
                      disabled={!hasBlocks}
                    >
                      <Save className="mr-2 h-4 w-4 shrink-0" />
                      <span className="whitespace-nowrap">
                        {isExistingConfig ? 'Update Config' : 'Save Config'}
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleReview}
                      disabled={!canReview}
                    >
                      <Check className="mr-2 h-4 w-4 shrink-0" />
                      <span className="whitespace-nowrap">Review & Submit</span>
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
                  <span className="hidden sm:inline">Back to Edit</span>
                </Button>

                <Button size="sm" disabled={!isValid} className="gap-2">
                  <Check className="h-4 w-4" />
                  <span className="hidden sm:inline">Submit Job</span>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>
    </>
  )
}
