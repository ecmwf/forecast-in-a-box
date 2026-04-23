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
 * on mount via useActivityCollector.
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
  addTask: (task: ActivityTask) => void
  updateTask: (id: string, updates: Partial<ActivityTask>) => void
  removeTask: (id: string) => void
  clearCompleted: () => void
  clearAll: () => void
}

const COMPLETED_CAP = 50

function evictOldestCompleted(
  tasks: Partial<Record<string, ActivityTask>>,
): Partial<Record<string, ActivityTask>> {
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

        addTask: (task) =>
          set(
            (state) => ({
              tasks: evictOldestCompleted({ ...state.tasks, [task.id]: task }),
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
              const { [id]: _, ...rest } = state.tasks
              return { tasks: rest }
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

        // Wipes everything, including active entries. The collector will
        // immediately re-add any tasks that are still live (e.g. an
        // in-progress download), so this effectively clears only the
        // history of completed/failed records.
        clearAll: () => set({ tasks: {} }, undefined, 'clearAll'),
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
          ) as Partial<Record<string, ActivityTask>>,
        }),
      },
    ),
    { name: 'ActivityStore' },
  ),
)
