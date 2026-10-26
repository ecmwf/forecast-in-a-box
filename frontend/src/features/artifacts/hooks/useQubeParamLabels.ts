/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useMemo } from 'react'
import type { QubeNode } from '@/api/types/artifacts.types'
import { useParamLabels } from '@/api/hooks/useFable'
import { parseParamDisplay } from '@/components/base/fields/param-display'

function paramValues(node: QubeNode, into: Set<string>): Set<string> {
  if (node.key === 'param')
    node.values.values.forEach((v) => into.add(String(v)))
  node.children.forEach((child) => paramValues(child, into))
  return into
}

/** Labels by id and shortname; shortname qubes borrow id-keyed ones. */
export function useQubeParamLabels(
  qubes: ReadonlyArray<QubeNode>,
): ReadonlyMap<string, string> {
  const values = useMemo(() => {
    const all = new Set<string>()
    qubes.forEach((qube) => paramValues(qube, all))
    return [...all]
  }, [qubes])
  const byId = useParamLabels(values)
  return useMemo(() => {
    const labels = new Map(byId)
    for (const display of byId.values()) {
      const { short } = parseParamDisplay(display)
      if (short !== undefined && !labels.has(short)) labels.set(short, display)
    }
    return labels
  }, [byId])
}
