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
import { useOnboardingStore } from '@/stores/onboardingStore'

// Cheap status read up front; the gate (queries + dialog) loads only for
// users who might actually see it.
const WelcomeGate = lazy(() =>
  import('./WelcomeGate').then((m) => ({ default: m.WelcomeGate })),
)

export function OnboardingController() {
  const status = useOnboardingStore((state) => state.status)
  const welcomeOpen = useOnboardingStore((state) => state.welcomeOpen)

  const mightShow =
    status === 'not-started' || status === 'snoozed' || welcomeOpen
  if (!mightShow) return null

  return (
    <Suspense fallback={null}>
      <WelcomeGate />
    </Suspense>
  )
}
