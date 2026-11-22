/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Pairs two GRIB outputs of one run for the compare view; a map server serves a whole folder, so a shared folder is refused. */

export interface ComparableOutput {
  blockId: string
  /** Representative marker task of the sink. */
  taskId: string
  title: string
  /** Marker retrievable and the sink has written every file. */
  written: boolean
  /** Output can no longer be retrieved. */
  lost: boolean
  /** Folder the sink wrote to; null until resolved. */
  dirPath: string | null
}

export type ComparePairState = 'ready' | 'writing' | 'sharedFolder' | 'lost'

function normalizeDir(path: string): string {
  return path.replace(/\/+$/, '')
}

/** Last segment of a folder path. */
export function folderName(path: string): string {
  const trimmed = normalizeDir(path)
  return trimmed.slice(trimmed.lastIndexOf('/') + 1)
}

/** Whether an output is ready to be opened on the map. */
export function outputReady(output: ComparableOutput): boolean {
  return output.written && !output.lost && output.dirPath !== null
}

export function comparePairState(
  a: ComparableOutput,
  b: ComparableOutput,
): ComparePairState {
  if (a.lost || b.lost) return 'lost'
  if (
    a.dirPath !== null &&
    b.dirPath !== null &&
    normalizeDir(a.dirPath) === normalizeDir(b.dirPath)
  ) {
    return 'sharedFolder'
  }
  return outputReady(a) && outputReady(b) ? 'ready' : 'writing'
}

/** Sinks whose folder is also another sink's folder. */
export function sharedFolderBlockIds(
  outputs: ReadonlyArray<ComparableOutput>,
): Set<string> {
  const byDir = new Map<string, Array<string>>()
  for (const output of outputs) {
    if (output.dirPath === null) continue
    const dir = normalizeDir(output.dirPath)
    byDir.set(dir, [...(byDir.get(dir) ?? []), output.blockId])
  }
  const shared = new Set<string>()
  for (const blockIds of byDir.values()) {
    if (blockIds.length > 1) blockIds.forEach((id) => shared.add(id))
  }
  return shared
}

/** Folder names once they tell several outputs apart, sink titles otherwise. */
export function outputLabels(
  outputs: ReadonlyArray<ComparableOutput>,
): Record<string, string> {
  const names = outputs.map((o) => (o.dirPath ? folderName(o.dirPath) : null))
  const distinct =
    outputs.length > 1 &&
    names.every((name) => name !== null) &&
    new Set(names).size === outputs.length
  return Object.fromEntries(
    outputs.map((o, i) => [o.blockId, distinct ? (names[i] ?? '') : o.title]),
  )
}

export type SlotPick = Record<'a' | 'b', string>

/** Put an output on a side; taking the other side's output swaps the two. */
export function pickSlot(
  picked: SlotPick,
  slot: 'a' | 'b',
  blockId: string,
): SlotPick {
  const other = slot === 'a' ? 'b' : 'a'
  if (picked[other] === blockId) return { a: picked.b, b: picked.a }
  return { ...picked, [slot]: blockId }
}
