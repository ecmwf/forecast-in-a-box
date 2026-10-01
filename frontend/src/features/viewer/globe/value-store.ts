/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useSyncExternalStore } from 'react'

/** A value read through useSyncExternalStore: writes re-render only its readers. */
export interface ValueStore<T> {
  get: () => T
  set: (value: T) => void
  subscribe: (listener: () => void) => () => void
}

export function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next) => {
      if (next === value) return
      value = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export const useValue = <T>(store: ValueStore<T>): T =>
  useSyncExternalStore(store.subscribe, store.get)
