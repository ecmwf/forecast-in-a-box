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
 * Subscribes the active step's advance condition to its real signal (URL
 * search or a tour-supplied state signal); fires `onMet` once per
 * `stepKey`. Sub-hooks run unconditionally, the advance kind gates inside.
 */

import { useEffect, useRef } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import type { AdvanceWhen, SearchRecord } from './types'

export function useAdvanceCondition({
  advance,
  stepKey,
  searchAtEntry,
  onMet,
}: {
  advance: AdvanceWhen
  stepKey: string
  searchAtEntry: SearchRecord
  onMet: () => void
}): void {
  // Raw-string selector is structural-sharing-safe; parse off the router.
  const router = useRouter()
  const searchStr = useRouterState({ select: (s) => s.location.searchStr })

  const metForRef = useRef<string | null>(null)
  const onMetRef = useRef(onMet)
  onMetRef.current = onMet
  const fire = () => {
    if (metForRef.current === stepKey) return
    metForRef.current = stepKey
    onMetRef.current()
  }
  const fireRef = useRef(fire)
  fireRef.current = fire

  useEffect(() => {
    if (advance.kind !== 'signal') return
    if (advance.check()) {
      fireRef.current()
      return
    }
    return advance.subscribe(() => {
      if (advance.check()) fireRef.current()
    })
  }, [advance, stepKey])

  useEffect(() => {
    if (advance.kind !== 'search') return
    const search = router.state.location.search as SearchRecord
    if (advance.check(search, searchAtEntry)) fireRef.current()
  }, [advance, stepKey, router, searchStr, searchAtEntry])
}
