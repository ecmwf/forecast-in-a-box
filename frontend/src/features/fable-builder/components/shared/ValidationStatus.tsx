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
 * Header validation badge. Issues render as a counted badge whose popover
 * lists them; clicking an issue selects the offending block.
 */

import { useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { BlockFactoryCatalogue } from '@/api/types/fable.types'
import { getFactory } from '@/api/types/fable.types'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { Badge } from '@/components/ui/badge'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface Issue {
  blockId: string | null
  label: string
  message: string
}

export function ValidationStatusBadge({
  className,
  catalogue,
}: {
  className?: string
  catalogue?: BlockFactoryCatalogue
}) {
  const { t } = useTranslation('configure')
  const validationState = useFableBuilderStore((state) => state.validationState)
  const isValidating = useFableBuilderStore((state) => state.isValidating)
  const fable = useFableBuilderStore((state) => state.fable)
  const selectBlock = useFableBuilderStore((state) => state.selectBlock)
  const [open, setOpen] = useState(false)

  const issues = useMemo<Array<Issue>>(() => {
    if (!validationState) return []
    const list: Array<Issue> = []
    for (const message of validationState.globalErrors) {
      list.push({
        blockId: null,
        label: t('validationStatus.globalIssueLabel'),
        message,
      })
    }
    for (const [blockId, state] of Object.entries(
      validationState.blockStates,
    )) {
      if (!state.hasErrors) continue
      // `in` guard, not `?.`: index access is typed non-nullable here.
      const block = blockId in fable.blocks ? fable.blocks[blockId] : undefined
      let label = blockId
      if (block) {
        const factoryTitle = catalogue
          ? getFactory(catalogue, block.factory_id)?.title
          : undefined
        label = factoryTitle ?? block.factory_id.factory
      }
      for (const message of state.errors) {
        list.push({ blockId, label, message })
      }
      for (const names of Object.values(state.missingGlyphs)) {
        for (const name of names) {
          list.push({
            blockId,
            label,
            message: t('fieldErrors.unknownGlyph', { glyph: `\${${name}}` }),
          })
        }
      }
    }
    return list
  }, [validationState, fable.blocks, catalogue, t])

  if (isValidating) {
    return (
      <Badge variant="secondary" className={cn('gap-1', className)}>
        <Loader2 className="h-3 w-3 animate-spin" />
        {t('validationStatus.validating')}
      </Badge>
    )
  }

  if (!validationState) {
    return null
  }

  if (issues.length === 0) {
    return (
      <Badge
        variant="outline"
        className={cn('gap-1 border-green-200 text-green-600', className)}
      >
        <CheckCircle2 className="h-3 w-3" />
        {t('validationStatus.valid')}
      </Badge>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Badge
            variant="destructive"
            render={<button type="button" />}
            className={cn('cursor-pointer gap-1', className)}
          />
        }
      >
        <AlertCircle className="h-3 w-3" />
        {t('validationStatus.issues', { count: issues.length })}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <p className="px-2 py-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('validationStatus.configurationIssues')}
        </p>
        <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
          {issues.map((issue, index) => (
            <button
              key={index}
              type="button"
              disabled={issue.blockId === null}
              onClick={() => {
                if (issue.blockId === null) return
                selectBlock(issue.blockId)
                setOpen(false)
              }}
              className="min-w-0 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
            >
              <span className="block font-medium">{issue.label}</span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {issue.message}
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
