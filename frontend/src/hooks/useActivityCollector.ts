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
import i18n from 'i18next'
import { useArtifacts, useDownloadModel } from '@/api/hooks/useArtifacts'
import { useRecentRuns } from '@/api/hooks/useJobs'
import { useServerTime } from '@/api/hooks/useSchedules'
import { isTerminalStatus } from '@/api/types/job.types'
import { useActivityStore } from '@/stores/activityStore'
import { capitalize } from '@/utils/formatters'

/**
 * Sync model downloads from the download store into the activity store.
 */
function useCollectDownloads() {
  const { downloads } = useDownloadModel()
  const { artifacts } = useArtifacts()
  const prevKeysRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const { tasks, dismissed, addTask, updateTask, forgetDismissed } =
      useActivityStore.getState()
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
          ? i18n.t('common:activity.downloadStarting')
          : i18n.t('common:activity.downloadProgress', { progress })

      const existing = tasks[id]
      if (existing) {
        updateTask(id, { progress, description })
      } else if (!dismissed[id]) {
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
        const done = {
          status: 'completed' as const,
          description: i18n.t('common:activity.downloadComplete'),
          progress: 100,
          completedAt: Date.now(),
        }
        if (task && task.status === 'active') {
          updateTask(id, done)
        } else if (dismissed[id]) {
          // Dismissed while running; the outcome is still news.
          addTask({
            id,
            type: 'download',
            label: nameByKey.get(key) ?? key.replace('--', '/'),
            startedAt: Date.now(),
            navigateTo: '/admin/artifacts',
            ...done,
          })
        }
      }
    }

    const stale = Object.keys(dismissed).filter(
      (id) => id.startsWith('download:') && !currentKeys.has(id.slice(9)),
    )
    if (stale.length > 0) forgetDismissed(stale)

    prevKeysRef.current = currentKeys
  }, [downloads, artifacts])
}

/**
 * Sync forecast jobs from the job list into the activity store.
 */
function useCollectJobs() {
  const { data: runs } = useRecentRuns(20)
  const { serverTimeToLocal } = useServerTime()

  useEffect(() => {
    if (!runs) return
    const { tasks, dismissed, addTask, updateTask, forgetDismissed } =
      useActivityStore.getState()

    for (const job of runs) {
      const id = `job:${job.run_id}`
      const label = i18n.t('common:activity.jobLabel', {
        id: job.run_id.slice(0, 8),
      })
      const isTerminal = isTerminalStatus(job.status)
      const outcome = {
        status:
          job.status === 'completed'
            ? ('completed' as const)
            : ('failed' as const),
        description:
          job.status === 'completed'
            ? i18n.t('common:activity.jobCompleted')
            : i18n.t('common:activity.jobFailed', {
                error: job.error ?? i18n.t('common:activity.unknownError'),
              }),
        completedAt: Date.now(),
      }

      const existingTask = tasks[id]
      if (existingTask) {
        // Update existing
        if (isTerminal && existingTask.status === 'active') {
          updateTask(id, outcome)
        } else if (!isTerminal) {
          updateTask(id, { description: capitalize(job.status) })
        }
      } else if (isTerminal ? dismissed[id] : !dismissed[id]) {
        // New active job (unless dismissed), or a dismissed one that finished.
        addTask({
          id,
          type: 'job',
          label,
          description: capitalize(job.status),
          status: 'active',
          startedAt: serverTimeToLocal(job.created_at).getTime(),
          navigateTo: `/execute/${job.run_id}`,
          ...(isTerminal && outcome),
        })
      }
    }

    // Runs that left the recent window cannot come back; drop their dismissals.
    const live = new Set(runs.map((job) => `job:${job.run_id}`))
    const stale = Object.keys(dismissed).filter(
      (id) => id.startsWith('job:') && !live.has(id),
    )
    if (stale.length > 0) forgetDismissed(stale)
  }, [runs, serverTimeToLocal])
}

/**
 * Mount this hook once in the app shell to collect activity from all sources.
 * Completed/failed entries remain in the Notification Center until the user
 * dismisses them (individually or via "Clear"). A dismissed active task stays
 * hidden until it finishes, then reappears once with its outcome.
 */
export function useActivityCollector() {
  useCollectDownloads()
  useCollectJobs()
}
