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

function sameFolder(a: ComparableOutput, b: ComparableOutput): boolean {
  return (
    a.dirPath !== null &&
    b.dirPath !== null &&
    normalizeDir(a.dirPath) === normalizeDir(b.dirPath)
  )
}

export function comparePairState(
  a: ComparableOutput,
  b: ComparableOutput,
): ComparePairState {
  if (a.lost || b.lost) return 'lost'
  if (sameFolder(a, b)) return 'sharedFolder'
  return outputReady(a) && outputReady(b) ? 'ready' : 'writing'
}

/** Whether a pair can be opened now or once it is written. */
export function pairUsable(state: ComparePairState): boolean {
  return state === 'ready' || state === 'writing'
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

/** Folder name where it is unique among the outputs, sink title otherwise; titles only while a folder is unresolved. */
export function outputLabels(
  outputs: ReadonlyArray<ComparableOutput>,
): Record<string, string> {
  const names = outputs.map((o) => (o.dirPath ? folderName(o.dirPath) : null))
  const pending = outputs.some((o) => o.dirPath === null && !o.lost)
  const named = outputs.length > 1 && !pending
  return Object.fromEntries(
    outputs.map((o, i) => {
      const name = names[i]
      const unique = names.filter((other) => other === name).length === 1
      return [o.blockId, named && name !== null && unique ? name : o.title]
    }),
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

/** First pair that can be compared; the first two outputs when none can. */
export function defaultPair(
  outputs: ReadonlyArray<ComparableOutput>,
): SlotPick | null {
  if (outputs.length < 2) return null
  for (let i = 0; i < outputs.length; i++) {
    for (let j = i + 1; j < outputs.length; j++) {
      if (pairUsable(comparePairState(outputs[i], outputs[j]))) {
        return { a: outputs[i].blockId, b: outputs[j].blockId }
      }
    }
  }
  return { a: outputs[0].blockId, b: outputs[1].blockId }
}

/** Why an output cannot take a side next to the other side's output. */
export function pickBlocker(
  candidate: ComparableOutput,
  other: ComparableOutput,
): 'lost' | 'sharedFolder' | null {
  if (candidate.lost) return 'lost'
  // The other side's own output is a swap.
  if (candidate.blockId !== other.blockId && sameFolder(candidate, other)) {
    return 'sharedFolder'
  }
  return null
}
