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
 * All guided tours, keyed by id; bundled with the lazy runner chunk, so
 * launch surfaces reference ids only.
 */

import {
  firstMapDefinition,
  useFirstMapLaunchContext,
} from './tutorials/visualise-first-map'
import {
  firstRunDefinition,
  useFirstRunLaunchContext,
} from './tutorials/configure-first-run'
import type { TutorialDefinition, TutorialId } from './engine/types'

export interface TutorialEntry<TLaunch = unknown> {
  definition: TutorialDefinition<TLaunch>
  /** Launch signals; `null` while they resolve. */
  useLaunchContext: () => TLaunch | null
}

/** Erases the launch type; the runner only hands it back to the definition. */
function defineTutorial<TLaunch>(entry: TutorialEntry<TLaunch>): TutorialEntry {
  return entry as unknown as TutorialEntry
}

export const TUTORIALS: Record<TutorialId, TutorialEntry> = {
  'visualise-first-map': defineTutorial({
    definition: firstMapDefinition,
    useLaunchContext: useFirstMapLaunchContext,
  }),
  'configure-first-run': defineTutorial({
    definition: firstRunDefinition,
    useLaunchContext: useFirstRunLaunchContext,
  }),
}
