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
 */

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

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
}

export const useActivityStore = create<ActivityState>()(
  devtools(
    (set) => ({
      tasks: {},

      addTask: (task) =>
        set(
          (state) => ({ tasks: { ...state.tasks, [task.id]: task } }),
          undefined,
          'addTask',
        ),

      updateTask: (id, updates) =>
        set(
          (state) => {
            const existing = state.tasks[id]
            if (!existing) return state
            return {
              tasks: { ...state.tasks, [id]: { ...existing, ...updates } },
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
    }),
    { name: 'ActivityStore' },
  ),
)
