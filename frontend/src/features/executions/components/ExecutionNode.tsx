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
import type { NodeProps } from '@xyflow/react'
import type { FableNodeData } from '@/features/fable-builder/utils/fable-to-graph'
import type { BlockKind } from '@/api/types/fable.types'
import { BLOCK_KIND_METADATA, getBlockKindIcon } from '@/api/types/fable.types'
import { useShowConfig } from '@/features/executions/components/ExecutionCanvas'
import { cn } from '@/lib/utils'

const NODE_TYPE_TO_KIND: Record<string, BlockKind> = {
  sourceBlock: 'source',
  transformBlock: 'transform',
  productBlock: 'product',
  sinkBlock: 'sink',
}

/**
 * Vertical centre of the node's header row, in pixels from the top of the
 * node. Keeping handles pinned here means they line up horizontally across
 * nodes regardless of how tall the optional config block makes the body —
 * which is what makes a `smoothstep` edge collapse to a straight line.
 */
const HANDLE_Y_PX = 32
/** Vertical spacing between adjacent handles on a multi-input target. */
const MULTI_HANDLE_GAP_PX = 12

export const ExecutionNode = memo(function ({ data, type }: NodeProps) {
  const nodeData = data as FableNodeData
  const showConfig = useShowConfig()
  const kind = NODE_TYPE_TO_KIND[type] ?? 'source'
  const kindMeta = BLOCK_KIND_METADATA[kind]
  const Icon = getBlockKindIcon(kind)

  const inputNames = Object.keys(nodeData.instance.input_ids)
  const configEntries = Object.entries(
    nodeData.instance.configuration_values,
  ).filter(([, v]) => v !== '')
  const configOptions = nodeData.factory.configuration_options

  return (
    <div
      className={cn(
        'relative rounded-lg border bg-card shadow-sm',
        showConfig && configEntries.length > 0 ? 'w-[200px]' : 'w-[140px]',
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

      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="h-2! w-2! border! border-border! bg-muted-foreground/40!"
        style={{ top: `${HANDLE_Y_PX}px`, transform: 'translateY(-50%)' }}
      />

      <div className={cn('h-1 rounded-t-lg', kindMeta.topBarColor)} />
      <div className="space-y-1 p-2.5">
        <div className="flex items-center gap-1.5">
          <Icon className={cn('h-3.5 w-3.5 shrink-0', kindMeta.color)} />
          <span className="truncate text-sm font-medium">{nodeData.label}</span>
        </div>
        <span className="text-sm text-muted-foreground">{kindMeta.label}</span>
      </div>

      {showConfig && configEntries.length > 0 && (
        <div className="border-t border-border px-2 py-1">
          {configEntries.map(([key, value]) => (
            <div
              key={key}
              className="flex items-baseline justify-between gap-1 py-px"
            >
              <span className="shrink-0 text-xs text-muted-foreground">
                {configOptions[key].title}
              </span>
              <span className="max-w-[100px] truncate text-right font-mono text-xs">
                {value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
