/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Suspense, lazy } from 'react'
import { useTutorialsStore } from '@/stores/tutorialsStore'

// Cheap flag read; the heavy runner loads only once a tour starts.
const TutorialRunner = lazy(() =>
  import('./TutorialRunner').then((m) => ({ default: m.TutorialRunner })),
)

export function TutorialsController() {
  const running = useTutorialsStore((state) => state.active !== null)
  if (!running) return null

  return (
    <Suspense fallback={null}>
      <TutorialRunner />
    </Suspense>
  )
}
