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
 * Capture → self-describing export canvases (baked title bar, per-slot
 * legends, numbered note strip) — shared by PNG download and copy.
 */

import { composeExportCanvas, loadLegendImage } from '../map-export'
import { ANNOTATION_COLORS, annotationVisibleOn } from './annotations'
import type { MapAnnotation } from './annotations'
import type { ExportNote, LegendExportItem } from '../map-export'
import type { SourceSlot } from './layer-pairing'
import type { CaptureResult } from './types'

export interface ExportLegendSpec {
  slot: SourceSlot
  title: string
  url: string
}

/** Current slot→source-id assignment — resolves capture slots to pins. */
export interface ExportSlotIds {
  a: string
  b: string | null
}

interface LoadedLegend extends LegendExportItem {
  slot: SourceSlot
}

/** Legends relevant to one capture: its own slot, or all for combined. */
function legendsFor(
  capture: CaptureResult,
  legends: ReadonlyArray<LoadedLegend>,
): Array<LoadedLegend> {
  return legends.filter((l) => capture.slot === null || l.slot === capture.slot)
}

/** Notes for one capture — the annotations its panel actually shows,
 *  with their sticky labels and pin colors. */
function notesFor(
  capture: CaptureResult,
  annotations: ReadonlyArray<MapAnnotation>,
  slotIds: ExportSlotIds,
): Array<ExportNote> {
  const shown = (
    capture.slot === null ? [slotIds.a, slotIds.b] : [slotIds[capture.slot]]
  ).filter((id): id is string => id !== null)
  return annotations.flatMap((a) =>
    annotationVisibleOn(a, shown)
      ? [{ label: a.label, color: ANNOTATION_COLORS[a.color], text: a.text }]
      : [],
  )
}

/**
 * Run the capture and bake one composed canvas per map. Failed legend
 * loads are dropped silently — the map still exports. Throws when the
 * capture yields nothing.
 */
export async function composeCaptures({
  capture,
  legends,
  annotations,
  slotIds,
  title,
}: {
  capture: () => Promise<Array<CaptureResult>>
  legends: ReadonlyArray<ExportLegendSpec>
  annotations: ReadonlyArray<MapAnnotation>
  slotIds: ExportSlotIds
  /** Overrides each capture's own label when non-empty. */
  title?: string
}): Promise<Array<HTMLCanvasElement>> {
  const [captures, images] = await Promise.all([
    capture(),
    Promise.all(legends.map((l) => loadLegendImage(l.url))),
  ])
  if (captures.length === 0) throw new Error('Nothing to capture')
  const loaded = legends.flatMap((spec, i) => {
    const image = images[i]
    return image
      ? [
          {
            slot: spec.slot,
            title: `${spec.slot.toUpperCase()} · ${spec.title}`,
            image,
          },
        ]
      : []
  })
  return captures.flatMap((c) => {
    const composed = composeExportCanvas(c.canvas, {
      titles: [title?.trim() || c.label],
      timeText: c.timeLabel,
      titleBarEnabled: true,
      legendItems: legendsFor(c, loaded),
      notes: notesFor(c, annotations, slotIds),
    })
    return composed ? [composed] : []
  })
}
