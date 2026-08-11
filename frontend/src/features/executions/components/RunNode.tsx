/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { memo, useEffect, useRef, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Check, CheckCircle2, Copy, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { NodeProps } from '@xyflow/react'
import type { BlockKind } from '@/api/types/fable.types'
import type { FableNodeData } from '@/features/fable-builder/utils/fable-to-graph'
import { BLOCK_KIND_METADATA, getBlockKindIcon } from '@/api/types/fable.types'
import {
  useBlockProgress,
  useResolvedConfigFor,
  useShowConfig,
} from '@/features/executions/components/RunCanvas'
import {
  useIsBlockHovered,
  useIsBlockSelected,
} from '@/features/executions/stores/executionHoverStore'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { showToast } from '@/lib/toast'
import { cn, copyToClipboard } from '@/lib/utils'

/** Tooltip row: a mono value with its own copy-to-clipboard button. */
function CopyValueRow({
  text,
  label,
  dimmed = false,
}: {
  text: string
  label: string
  dimmed?: boolean
}) {
  const { t } = useTranslation('executions')
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(resetTimer.current), [])

  return (
    <div className="flex items-start gap-2 rounded-sm px-2 py-1.5">
      <span
        className={cn(
          'min-w-0 flex-1 font-mono break-all',
          dimmed && 'text-muted-foreground',
        )}
      >
        {text}
      </span>
      <button
        type="button"
        aria-label={label}
        title={copied ? t('detail.copied') : label}
        onClick={() => {
          void copyToClipboard(text).then((ok) => {
            if (!ok) {
              showToast.error(t('detail.copyFailed'))
              return
            }
            setCopied(true)
            window.clearTimeout(resetTimer.current)
            resetTimer.current = window.setTimeout(() => setCopied(false), 1500)
          })
        }}
        className="shrink-0 rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-success" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  )
}

const NODE_TYPE_TO_KIND: Record<string, BlockKind> = {
  sourceBlock: 'source',
  transformBlock: 'transform',
  productBlock: 'product',
  sinkBlock: 'sink',
}

/** Y-offset of the node header centre. Keeping handles pinned here lets
 * smoothstep edges collapse to straight lines regardless of body height. */
const HANDLE_Y_PX = 32
/** Vertical spacing between adjacent handles on a multi-input target. */
const MULTI_HANDLE_GAP_PX = 12

export const RunNode = memo(function ({ data, type }: NodeProps) {
  const { t } = useTranslation('executions')
  const nodeData = data as FableNodeData
  const showConfig = useShowConfig()
  const { completedSet, runningSet, plannedSet } = useBlockProgress()
  const isHovered = useIsBlockHovered(nodeData.instanceId)
  const isSelected = useIsBlockSelected(nodeData.instanceId)
  const kind = NODE_TYPE_TO_KIND[type] ?? 'source'
  const kindMeta = BLOCK_KIND_METADATA[kind]
  const Icon = getBlockKindIcon(kind)

  const isCompleted = completedSet.has(nodeData.instanceId)
  const isRunning = runningSet.has(nodeData.instanceId)
  // Only dim when the backend confirmed a plan that excludes this node.
  const isPlannedIdle =
    plannedSet.size > 0 &&
    plannedSet.has(nodeData.instanceId) &&
    !isCompleted &&
    !isRunning

  const inputNames = Object.keys(nodeData.instance.input_ids)
  const resolved = useResolvedConfigFor(nodeData.instanceId)
  const configEntries = Object.entries(
    nodeData.instance.configuration_values,
  ).filter(([, v]) => v !== '')
  const configOptions = nodeData.factory.configuration_options

  return (
    <div
      className={cn(
        'relative cursor-pointer rounded-lg border bg-card shadow-sm transition-colors',
        showConfig && configEntries.length > 0 ? 'w-[200px]' : 'w-[140px]',
        isCompleted && 'border-l-2 border-l-emerald-500',
        isRunning && 'run-node-ringing border-amber-500',
        isPlannedIdle && 'opacity-60',
        isHovered && !isSelected && 'bg-primary/10',
        isSelected &&
          'ring-2 ring-primary ring-offset-2 ring-offset-background',
      )}
    >
      {inputNames.map((inputName, i) => {
        const offset =
          inputNames.length === 1
            ? 0
            : (i - (inputNames.length - 1) / 2) * MULTI_HANDLE_GAP_PX
        return (
          <Handle
            key={inputName}
            type="target"
            position={Position.Left}
            id={inputName}
            className="h-2! w-2! border! border-border! bg-muted-foreground/40!"
            style={{
              top: `${HANDLE_Y_PX + offset}px`,
              transform: 'translateY(-50%)',
            }}
          />
        )
      })}

      {/* Sinks have no downstream — hide the source handle for them. */}
      {kind !== 'sink' && (
        <Handle
          type="source"
          position={Position.Right}
          id="output"
          className="h-2! w-2! border! border-border! bg-muted-foreground/40!"
          style={{ top: `${HANDLE_Y_PX}px`, transform: 'translateY(-50%)' }}
        />
      )}

      {/* Overlay clips the bar to the card radius — a 4px bar can't render it itself. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
      >
        <div className={cn('h-1', kindMeta.topBarColor)} />
      </div>
      <div className="space-y-1 px-2.5 pt-3.5 pb-2.5">
        <div className="flex items-center gap-1.5">
          <Icon className={cn('h-3.5 w-3.5 shrink-0', kindMeta.color)} />
          <span className="truncate text-sm font-medium">{nodeData.label}</span>
          {isCompleted && (
            <CheckCircle2 className="ml-auto h-3.5 w-3.5 shrink-0 text-emerald-500" />
          )}
          {isRunning && (
            <Loader2 className="ml-auto h-3.5 w-3.5 shrink-0 animate-spin text-amber-500" />
          )}
        </div>
        <span className="text-sm text-muted-foreground">{kindMeta.label}</span>
      </div>

      {showConfig && configEntries.length > 0 && (
        // One provider for the whole card: the browser's own title tooltip is
        // too slow and unstyled for values this often truncated.
        <TooltipProvider delay={120}>
          <div className="border-t border-border px-2 py-1">
            {configEntries.map(([key, value]) => {
              // Show what the run used; the template stays reachable on hover.
              const asRun = resolved?.[key]
              const display = asRun ?? value
              const fromTemplate = asRun !== undefined && asRun !== value
              // The column truncates early, so anything longer needs the hover.
              const needsHover = fromTemplate || display.length > 12
              const valueClass = cn(
                'max-w-[100px] truncate text-right font-mono text-xs',
                // Marks a value that came from a variable; costs no width in a
                // column that already truncates.
                fromTemplate &&
                  'underline decoration-muted-foreground/60 decoration-dotted underline-offset-2',
              )
              return (
                <div
                  key={key}
                  className="flex items-baseline justify-between gap-1 py-px"
                >
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {configOptions[key].title}
                  </span>
                  {needsHover ? (
                    <Tooltip>
                      <TooltipTrigger render={<span className={valueClass} />}>
                        {display}
                      </TooltipTrigger>
                      <TooltipContent className="max-w-sm p-1">
                        <div className="flex min-w-0 flex-col">
                          <CopyValueRow
                            text={display}
                            label={t('detail.copyValue')}
                          />
                          {fromTemplate && (
                            <CopyValueRow
                              text={value}
                              label={t('detail.copyTemplate')}
                              dimmed
                            />
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <span className={valueClass}>{display}</span>
                  )}
                </div>
              )
            })}
          </div>
        </TooltipProvider>
      )}
    </div>
  )
})
