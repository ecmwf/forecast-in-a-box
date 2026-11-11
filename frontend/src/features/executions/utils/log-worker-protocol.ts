/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Messages between the page and the log worker. */

import type {
  LogSnapshotStore,
  LogSnapshotSummary,
  ViewRequest,
  ViewResult,
} from './log-snapshot'
import type { LogLocation } from './run-logs'

export type LogWorkerRequest =
  | { type: 'load'; zip: ArrayBuffer }
  | { type: 'view'; request: ViewRequest }
  | { type: 'fileBytes'; name: string }
  | { type: 'locate'; message: string }

export interface LogWorkerResults {
  load: LogSnapshotSummary
  view: ViewResult
  fileBytes: Uint8Array<ArrayBuffer>
  locate: LogLocation | undefined
}

export interface LogWorkerMessage {
  id: number
  request: LogWorkerRequest
}

export type LogWorkerReply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string }

/** Runs one request; `transfer` lists the buffers to move, not copy. */
export function handleLogRequest(
  store: LogSnapshotStore,
  request: LogWorkerRequest,
): { value: unknown; transfer: Array<Transferable> } {
  switch (request.type) {
    case 'load':
      return { value: store.load(new Uint8Array(request.zip)), transfer: [] }
    case 'view': {
      const value = store.view(request.request)
      const transfer: Array<Transferable> = []
      if (value.indices) transfer.push(value.indices.buffer)
      if (value.content) {
        transfer.push(value.content.starts.buffer, value.content.levels.buffer)
      }
      return { value, transfer }
    }
    case 'fileBytes': {
      const value = store.fileBytes(request.name).slice()
      return { value, transfer: [value.buffer] }
    }
    case 'locate':
      return { value: store.locate(request.message), transfer: [] }
  }
}
