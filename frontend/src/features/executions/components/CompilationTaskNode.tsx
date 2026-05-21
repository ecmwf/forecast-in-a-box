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
import { Handle, Position } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import type { NodeProps } from '@xyflow/react'
import type { CSSProperties } from 'react'
import type { TaskNodeData } from '@/features/executions/utils/taskDagLayout'
import {
  TASK_KIND_META,
  classifyTask,
} from '@/features/executions/utils/taskClassify'
import { humaniseTaskName } from '@/features/executions/utils/taskName'
import { cn } from '@/lib/utils'

interface CompilationTaskNodeProps extends NodeProps {
  data: TaskNodeData & {
    /** Set by the drawer when a hover anchor exists. */
    lineageState?: 'highlighted' | 'dimmed' | 'idle'
  }
}

const STAGGER_PER_NODE_MS = 28
/** Cap the cascade so larger DAGs don't take seconds to settle in. */
const STAGGER_MAX_DELAY_MS = 320

export const CompilationTaskNode = memo(function ({
  data,
  selected,
}: CompilationTaskNodeProps) {
  const { t } = useTranslation('executions')
  const { task, revealIndex, lineageState = 'idle' } = data
  const kind = classifyTask(task.task_id)
  const meta = TASK_KIND_META[kind]
  const Icon = meta.icon
  const humanised = humaniseTaskName(task.task_id)

  const delayMs = Math.min(
    revealIndex * STAGGER_PER_NODE_MS,
    STAGGER_MAX_DELAY_MS,
  )
  const style: CSSProperties = { animationDelay: `${delayMs}ms` }

  return (
    <div
      style={style}
      className={cn(
        'group/task w-[200px] rounded-md border bg-card px-2.5 py-1.5 text-left shadow-sm',
        'animate-[task-reveal_240ms_ease-out_both]',
        'motion-reduce:animate-none motion-reduce:opacity-100',
        'transition-[opacity,border-color,box-shadow] duration-150',
        selected && 'ring-2 ring-primary/50',
        lineageState === 'highlighted' && cn('border-2', meta.accentBorder),
        lineageState === 'dimmed' && 'opacity-30',
      )}
      data-lineage={lineageState}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="h-1.5! w-1.5! border! border-border! bg-muted-foreground/40!"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="h-1.5! w-1.5! border! border-border! bg-muted-foreground/40!"
      />

      <div className="flex items-center gap-1.5">
        <Icon className={cn('h-3.5 w-3.5 shrink-0', meta.iconColor)} />
        <span
          className="truncate text-sm font-medium"
          title={task.display_name}
        >
          {humanised.headline}
        </span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-1.5">
        <span className="truncate text-xs text-muted-foreground">
          {t(`compilation.taskKind.${meta.labelKey}`)}
        </span>
        {humanised.hashChip && (
          <span className="rounded-sm bg-muted px-1 py-px font-mono text-[10px] leading-none text-muted-foreground">
            {humanised.hashChip}
          </span>
        )}
      </div>
    </div>
  )
})
