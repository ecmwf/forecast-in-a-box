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
import { blockDisplayNames } from '../utils/block-names'
import type { BlockInstanceId, FableBuilderV1 } from '@/api/types/fable.types'
import { useBlockCatalogue } from '@/api/hooks/useFable'

/** Display name per block of `fable`, from the block catalogue. */
export function useBlockDisplayNames(
  fable: FableBuilderV1 | undefined,
): Record<BlockInstanceId, string> {
  const { data: catalogue } = useBlockCatalogue()
  return useMemo(
    () => (fable ? blockDisplayNames(fable, catalogue) : {}),
    [fable, catalogue],
  )
}
