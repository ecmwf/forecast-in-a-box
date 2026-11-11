/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Unpacks and searches a run's logs off the page's thread. */

import type {
  LogWorkerMessage,
  LogWorkerReply,
} from '@/features/executions/utils/log-worker-protocol'
import { LogSnapshotStore } from '@/features/executions/utils/log-snapshot'
import { handleLogRequest } from '@/features/executions/utils/log-worker-protocol'

const store = new LogSnapshotStore()

self.onmessage = (event: MessageEvent<LogWorkerMessage>) => {
  const { id, request } = event.data
  let reply: LogWorkerReply
  let transfer: Array<Transferable> = []
  try {
    const result = handleLogRequest(store, request)
    reply = { id, ok: true, value: result.value }
    transfer = result.transfer
  } catch (error) {
    reply = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
  self.postMessage(reply, { transfer })
}
