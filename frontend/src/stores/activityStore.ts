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
 * Activity Store
 *
 * Tracks all long-running tasks across the application:
 * plugin operations, model downloads, and forecast jobs.
 *
 * Completed/failed records persist across reloads (capped at the most
 * recent COMPLETED_CAP entries) so the Notification Center shows history.
 * Active tasks are NOT persisted — they are re-derived from live sources
 * on mount via useActivityCollector. Dismissing an active task records its
 * id so the collector leaves it hidden until the task finishes.
 */

import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { STORAGE_KEYS, STORE_VERSIONS } from '@/lib/storage-keys'

export type ActivityTaskType = 'plugin' | 'download' | 'job'
export type ActivityTaskStatus = 'active' | 'completed' | 'failed'

export interface ActivityTask {
  id: string
  type: ActivityTaskType
  label: string
  description: string
  status: ActivityTaskStatus
  progress?: number
  startedAt: number
  completedAt?: number
  navigateTo?: string
}

interface ActivityState {
  tasks: Partial<Record<string, ActivityTask>>
  /** Active tasks the user dismissed; the collector must not re-add them. */
  dismissed: Partial<Record<string, true>>
  addTask: (task: ActivityTask) => void
  updateTask: (id: string, updates: Partial<ActivityTask>) => void
  removeTask: (id: string) => void
  clearCompleted: () => void
  clearAll: () => void
  /** Drop dismissals whose tasks are gone from their live source. */
  forgetDismissed: (ids: ReadonlyArray<string>) => void
}

const COMPLETED_CAP = 50

/** v1 records predate the /executions→/execute and /dashboard→/overview
 *  route renames — persisted notification links must follow. */
export function rewriteLegacyRoute(path: string): string {
  return path
    .replace(/^\/executions(?=\/|$)/, '/execute')
    .replace(/^\/runs(?=\/|$)/, '/execute')
    .replace(/^\/dashboard(?=\/|$)/, '/overview')
}

function without(
  dismissed: Partial<Record<string, true>>,
  ids: ReadonlyArray<string>,
): Partial<Record<string, true>> {
  if (!ids.some((id) => dismissed[id])) return dismissed
  const next = { ...dismissed }
  for (const id of ids) delete next[id]
  return next
}

function evictOldestCompleted(
  tasks: Partial<Record<string, ActivityTask>>,
): Partial<Record<string, ActivityTask>> {
  // Fast path: with at most COMPLETED_CAP entries total there cannot be more
  // than COMPLETED_CAP completed ones, so the filter+sort below is never
  // needed. Skips that work on every addTask/updateTask (download-progress
  // ticks) until the map actually grows past the cap.
  const keys = Object.keys(tasks)
  if (keys.length <= COMPLETED_CAP) return tasks

  const entries = Object.entries(tasks).filter(
    (entry): entry is [string, ActivityTask] => entry[1] !== undefined,
  )
  const completed = entries
    .filter(([, task]) => task.status !== 'active')
    .sort(([, a], [, b]) => (b.completedAt ?? 0) - (a.completedAt ?? 0))

  if (completed.length <= COMPLETED_CAP) return tasks

  const toEvict = new Set(completed.slice(COMPLETED_CAP).map(([id]) => id))
  const next: Partial<Record<string, ActivityTask>> = {}
  for (const [id, task] of entries) {
    if (!toEvict.has(id)) next[id] = task
  }
  return next
}

export const useActivityStore = create<ActivityState>()(
  devtools(
    persist(
      (set) => ({
        tasks: {},
        dismissed: {},

        // Adding is deliberate, so it lifts an earlier dismissal of the id.
        addTask: (task) =>
          set(
            (state) => ({
              tasks: evictOldestCompleted({ ...state.tasks, [task.id]: task }),
              dismissed: without(state.dismissed, [task.id]),
            }),
            undefined,
            'addTask',
          ),

        updateTask: (id, updates) =>
          set(
            (state) => {
              const existing = state.tasks[id]
              if (!existing) return state
              return {
                tasks: evictOldestCompleted({
                  ...state.tasks,
                  [id]: { ...existing, ...updates },
                }),
              }
            },
            undefined,
            'updateTask',
          ),

        removeTask: (id) =>
          set(
            (state) => {
              const { [id]: removed, ...rest } = state.tasks
              return removed?.status === 'active'
                ? { tasks: rest, dismissed: { ...state.dismissed, [id]: true } }
                : { tasks: rest }
            },
            undefined,
            'removeTask',
          ),

        clearCompleted: () =>
          set(
            (state) => {
              const tasks: Record<string, ActivityTask> = {}
              for (const [id, task] of Object.entries(state.tasks)) {
                if (task && task.status === 'active') {
                  tasks[id] = task
                }
              }
              return { tasks }
            },
            undefined,
            'clearCompleted',
          ),

        // Active entries stay hidden until they finish; the collector re-adds
        // a finished one so the outcome still shows.
        clearAll: () =>
          set(
            (state) => {
              const dismissed = { ...state.dismissed }
              for (const [id, task] of Object.entries(state.tasks)) {
                if (task?.status === 'active') dismissed[id] = true
              }
              return { tasks: {}, dismissed }
            },
            undefined,
            'clearAll',
          ),

        forgetDismissed: (ids) =>
          set(
            (state) => ({ dismissed: without(state.dismissed, ids) }),
            undefined,
            'forgetDismissed',
          ),
      }),
      {
        name: STORAGE_KEYS.stores.activity,
        version: STORE_VERSIONS.activity,
        // Only persist completed/failed tasks. Active tasks are transient —
        // they would become stale "active forever" records across reloads.
        // The collector re-derives live tasks from their real data sources.
        partialize: (state) => ({
          tasks: Object.fromEntries(
            Object.entries(state.tasks).filter(
              ([, task]) => task !== undefined && task.status !== 'active',
            ),
          ),
          dismissed: state.dismissed,
        }),
        migrate: (persisted, version) => {
          const state = persisted as {
            tasks?: Partial<Record<string, ActivityTask>>
          }
          if (version >= 2 || !state.tasks) return state
          return {
            tasks: Object.fromEntries(
              Object.entries(state.tasks).map(([id, task]) => [
                id,
                task?.navigateTo !== undefined
                  ? { ...task, navigateTo: rewriteLegacyRoute(task.navigateTo) }
                  : task,
              ]),
            ),
          }
        },
      },
    ),
    { name: 'ActivityStore' },
  ),
)
