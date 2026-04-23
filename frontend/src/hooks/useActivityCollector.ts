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
 * Activity Collector Hook
 *
 * Mounted once in the app shell. Watches existing data sources
 * (model downloads, forecast jobs) and feeds the activity store.
 *
 * Plugin operations are reported directly by the plugin page
 * via useActivityStore.addTask() since plugin mutations don't
 * have globally observable mutation keys.
 *
 * IMPORTANT: Effects read the activity store via getState() (non-reactive)
 * to avoid infinite re-render loops. Only external data sources (downloads,
 * job list) are in dependency arrays.
 */

import { useEffect, useRef } from 'react'
import { useArtifacts, useDownloadModel } from '@/api/hooks/useArtifacts'
import { useJobsStatus } from '@/api/hooks/useJobs'
import { isTerminalStatus } from '@/api/types/job.types'
import { useActivityStore } from '@/stores/activityStore'

/**
 * Sync model downloads from the download store into the activity store.
 */
function useCollectDownloads() {
  const { downloads } = useDownloadModel()
  const { artifacts } = useArtifacts()
  const prevKeysRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const { tasks, addTask, updateTask } = useActivityStore.getState()
    const currentKeys = new Set(Object.keys(downloads))

    // Build a name lookup from the artifacts list
    const nameByKey = new Map<string, string>()
    for (const a of artifacts) {
      nameByKey.set(a.encodedId, a.displayName)
    }

    // Add or update active downloads
    for (const [key, dl] of Object.entries(downloads)) {
      const id = `download:${key}`
      const label = nameByKey.get(key) ?? key.replace('--', '/')
      const progress = dl.progress
      const description =
        dl.status === 'submitting'
          ? 'Starting download...'
          : `Downloading ${progress}%`

      const existing = tasks[id]
      if (existing) {
        updateTask(id, { progress, description })
      } else {
        addTask({
          id,
          type: 'download',
          label,
          description,
          status: 'active',
          progress,
          startedAt: Date.now(),
          navigateTo: '/admin/artifacts',
        })
      }
    }

    // Detect completed downloads (were in prev, not in current)
    for (const key of prevKeysRef.current) {
      if (!currentKeys.has(key)) {
        const id = `download:${key}`
        const task = tasks[id]
        if (task && task.status === 'active') {
          updateTask(id, {
            status: 'completed',
            description: 'Download complete',
            progress: 100,
            completedAt: Date.now(),
          })
        }
      }
    }

    prevKeysRef.current = currentKeys
  }, [downloads, artifacts])
}

/**
 * Sync forecast jobs from the job list into the activity store.
 */
function useCollectJobs() {
  const { data } = useJobsStatus(1, 20)

  useEffect(() => {
    if (!data?.runs) return
    const { tasks, addTask, updateTask } = useActivityStore.getState()

    for (const job of data.runs) {
      const id = `job:${job.run_id}`
      const label = `Job ${job.run_id.slice(0, 8)}`
      const isTerminal = isTerminalStatus(job.status)

      const existingTask = tasks[id]
      if (existingTask) {
        // Update existing
        if (isTerminal && existingTask.status === 'active') {
          updateTask(id, {
            status: job.status === 'completed' ? 'completed' : 'failed',
            description:
              job.status === 'completed'
                ? 'Completed'
                : `Failed: ${job.error ?? 'Unknown error'}`,
            completedAt: Date.now(),
          })
        } else if (!isTerminal) {
          updateTask(id, { description: capitalize(job.status) })
        }
      } else if (!isTerminal) {
        // Add new active job (only if not already added by SubmitJobDialog)
        addTask({
          id,
          type: 'job',
          label,
          description: capitalize(job.status),
          status: 'active',
          startedAt: new Date(job.created_at).getTime(),
          navigateTo: `/executions/${job.run_id}`,
        })
      }
    }
  }, [data])
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Mount this hook once in the app shell to collect activity from all sources.
 * Completed/failed entries remain in the Notification Center until the user
 * dismisses them (individually or via "Clear").
 */
export function useActivityCollector() {
  useCollectDownloads()
  useCollectJobs()
}
