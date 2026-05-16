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
 * Utility functions for formatting data.
 *
 * Date helpers render in the application timezone (default UTC). Components
 * should prefer `useDateFormatter()` so the output updates when the user
 * changes the timezone; non-component code may pass an explicit `timeZone`.
 */

import { useMemo } from 'react'
import { getAppTimeZone, useAppTimeZone } from '@/lib/datetime'

function toDate(date: Date | string | number): Date {
  return typeof date === 'string' || typeof date === 'number'
    ? new Date(date)
    : date
}

/**
 * Format a date as a localized date string, in the application timezone.
 */
export function formatDate(
  date: Date | string | number,
  timeZone: string = getAppTimeZone(),
): string {
  return toDate(date).toLocaleDateString(undefined, { timeZone })
}

/**
 * Format a date as a localized time string, in the application timezone.
 */
export function formatTime(
  date: Date | string | number,
  timeZone: string = getAppTimeZone(),
): string {
  return toDate(date).toLocaleTimeString(undefined, { timeZone })
}

/**
 * Format a date as a localized date-time string, in the application timezone.
 */
export function formatDateTime(
  date: Date | string | number,
  timeZone: string = getAppTimeZone(),
): string {
  return toDate(date).toLocaleString(undefined, { timeZone })
}

/**
 * Format a date as a relative time string (e.g. "2 hours ago"). Relative time
 * is timezone-independent; `timeZone` only affects the >30-day date fallback.
 */
export function formatRelativeTime(
  date: Date | string | number,
  timeZone: string = getAppTimeZone(),
): string {
  const d = toDate(date)
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - d.getTime()) / 1000)

  if (diffInSeconds < 60) {
    return 'just now'
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60)
  if (diffInMinutes < 60) {
    return `${diffInMinutes} minute${diffInMinutes === 1 ? '' : 's'} ago`
  }

  const diffInHours = Math.floor(diffInMinutes / 60)
  if (diffInHours < 24) {
    return `${diffInHours} hour${diffInHours === 1 ? '' : 's'} ago`
  }

  const diffInDays = Math.floor(diffInHours / 24)
  if (diffInDays < 30) {
    return `${diffInDays} day${diffInDays === 1 ? '' : 's'} ago`
  }

  return formatDate(d, timeZone)
}

/**
 * Component hook returning date formatters bound to the app timezone. The
 * returned functions update when the user changes the timezone.
 */
export function useDateFormatter() {
  const timeZone = useAppTimeZone()
  return useMemo(
    () => ({
      formatDate: (date: Date | string | number) => formatDate(date, timeZone),
      formatTime: (date: Date | string | number) => formatTime(date, timeZone),
      formatDateTime: (date: Date | string | number) =>
        formatDateTime(date, timeZone),
    }),
    [timeZone],
  )
}

/**
 * Truncate a string to a maximum length with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 3) + '...'
}

/**
 * Capitalize the first letter of a string
 */
export function capitalize(str: string): string {
  if (!str) return ''
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
}

/**
 * Format a number with thousand separators
 */
export function formatNumber(num: number): string {
  return num.toLocaleString()
}

/**
 * Format bytes to human-readable size
 */
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB']

  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}
