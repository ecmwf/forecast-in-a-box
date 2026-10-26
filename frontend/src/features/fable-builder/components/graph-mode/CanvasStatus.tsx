/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Panel, useViewport } from '@xyflow/react'
import { useTranslation } from 'react-i18next'

interface CanvasStatusProps {
  nodeCount: number
  edgeCount: number
}

/** Zoom level and graph size, sitting beside the canvas controls. */
export function CanvasStatus({ nodeCount, edgeCount }: CanvasStatusProps) {
  const { t } = useTranslation('configure')
  const { zoom } = useViewport()

  return (
    <Panel position="bottom-left" className="bottom-2! left-[2.625rem]!">
      <div
        aria-live="off"
        className="flex h-6 items-center gap-1.5 rounded-md border border-border bg-background/90 px-2 text-xs text-muted-foreground tabular-nums backdrop-blur-sm"
      >
        <span>{t('canvasStatus.zoom', { value: Math.round(zoom * 100) })}</span>
        <span aria-hidden>·</span>
        <span>{t('blockCount', { count: nodeCount })}</span>
        <span aria-hidden>·</span>
        <span>{t('canvasStatus.edgeCount', { count: edgeCount })}</span>
      </div>
    </Panel>
  )
}
