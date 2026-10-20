/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Run attempt each lens was started for; the backend knows only its folder. */

import { readStorageJson, writeStorageJson } from '@/lib/storage'
import { STORAGE_KEYS } from '@/lib/storage-keys'

/** Oldest records drop past this; lens ids are never reused. */
const MAX_RECORDS = 100

type LensOwners = Record<string, string>

function readOwners(): LensOwners {
  const stored = readStorageJson<unknown>(STORAGE_KEYS.visualise.lensOwners)
  return typeof stored === 'object' && stored !== null && !Array.isArray(stored)
    ? (stored as LensOwners)
    : {}
}

export function lensOwnerKey(jobId: string, attempt: number): string {
  return `${jobId}#${attempt}`
}

/** Owner a lens was started for; undefined when started elsewhere. */
export function lensOwner(lensId: string): string | undefined {
  return readOwners()[lensId]
}

export function setLensOwner(lensId: string, owner: string): void {
  const owners = { ...readOwners(), [lensId]: owner }
  const ids = Object.keys(owners)
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_RECORDS))) {
    delete owners[id]
  }
  writeStorageJson(STORAGE_KEYS.visualise.lensOwners, owners)
}

/** A lens fits unless it was started for another run attempt. */
export function lensFitsOwner(lensId: string, owner: string | null): boolean {
  if (owner === null) return true
  const recorded = lensOwner(lensId)
  return recorded === undefined || recorded === owner
}
