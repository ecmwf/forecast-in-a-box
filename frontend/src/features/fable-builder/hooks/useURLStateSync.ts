/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useCallback, useEffect, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { FableBuilderV1 } from '@/api/types/fable.types'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import {
  decodeFableFromURL,
  encodeFableToURL,
  isStateTooLarge,
} from '@/features/fable-builder/utils/url-state'
import { createLogger } from '@/lib/logger'

const log = createLogger('URLStateSync')

interface UseURLStateSyncOptions {
  encodedState?: string
  enabled?: boolean
}

export function useURLStateSync({
  encodedState,
  enabled = true,
}: UseURLStateSyncOptions = {}): { loadedFromURL: boolean } {
  const navigate = useNavigate()
  const fable = useFableBuilderStore((state) => state.fable)
  const setFable = useFableBuilderStore((state) => state.setFable)

  const initializedRef = useRef(false)
  const lastEncodedRef = useRef<string | null>(encodedState ?? null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isUpdatingURLRef = useRef(false)

  useEffect(() => {
    if (!enabled || initializedRef.current) return
    if (!encodedState) {
      initializedRef.current = true
      return
    }

    const decoded = decodeFableFromURL(encodedState)
    if (decoded) {
      setFable(decoded, null)
      lastEncodedRef.current = encodedState
    }
    initializedRef.current = true
    // Intentionally only run on mount to sync initial URL state
  }, [])

  const updateURL = useCallback(
    (newFable: FableBuilderV1) => {
      const encoded = encodeFableToURL(newFable)
      if (encoded === lastEncodedRef.current) return

      lastEncodedRef.current = encoded
      isUpdatingURLRef.current = true

      if (isStateTooLarge(encoded)) {
        log.warn('Configuration is large. URL may not work in all browsers.', {
          encodedLength: encoded.length,
        })
      }

      navigate({
        to: '/configure',
        search: { state: encoded },
        replace: true,
      })

      requestAnimationFrame(() => {
        isUpdatingURLRef.current = false
      })
    },
    [navigate],
  )

  useEffect(() => {
    if (!enabled || !initializedRef.current || isUpdatingURLRef.current) return

    const blockCount = Object.keys(fable.blocks).length
    if (blockCount === 0) return

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      updateURL(fable)
    }, 300)

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [fable, enabled, updateURL])

  return { loadedFromURL: !!encodedState }
}
