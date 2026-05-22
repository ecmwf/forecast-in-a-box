/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { NodeProps } from '@xyflow/react'
import type { BlockGroupData } from '@/features/executions/utils/taskDagLayout'
import { useExecutionHoverStore } from '@/features/executions/stores/executionHoverStore'
import { cn } from '@/lib/utils'

/** Swimlane container drawn behind the task cluster on the Compilation tab.
 * `pointer-events-none` lets clicks pass through to the task nodes on top. */
export const CompilationBlockNode = memo(function ({ data }: NodeProps) {
  const { t } = useTranslation('executions')
  const {
    blockId,
    label,
    taskCount,
    isContributing = null,
  } = data as BlockGroupData & { isContributing?: boolean | null }
  const selectedBlockId = useExecutionHoverStore(
    (state) => state.selectedBlockId,
  )
  const isSelected = selectedBlockId === blockId
  // Dim only if the data-flow set excludes this swimlane entirely.
  const isDimmed =
    !isSelected && isContributing !== null && isContributing === false
  return (
    <div
      className={cn(
        'pointer-events-none flex h-full w-full flex-col rounded-lg border border-dashed border-border bg-muted/30 transition-all',
        isSelected && 'border-solid border-primary bg-primary/10 shadow-md',
        isDimmed && 'opacity-40',
      )}
    >
      <div className="flex items-center justify-between gap-2 px-2.5 py-1">
        <span
          className={cn(
            'truncate text-xs font-medium',
            isSelected ? 'text-primary' : 'text-muted-foreground',
          )}
          title={label}
        >
          {label}
        </span>
        <span className="shrink-0 rounded-sm bg-background px-1 py-px font-mono text-[10px] text-muted-foreground">
          {t('compilation.taskCount', { count: taskCount })}
        </span>
      </div>
    </div>
  )
})
