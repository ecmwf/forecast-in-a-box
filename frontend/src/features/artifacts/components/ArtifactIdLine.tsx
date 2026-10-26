/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Model id; tells same-name variants apart. */

import type { CompositeArtifactId } from '@/api/types/artifacts.types'
import { artifactIdToWire } from '@/api/types/artifacts.types'
import { cn } from '@/lib/utils'

interface ArtifactIdLineProps {
  id: CompositeArtifactId
  /** Prefix the store id. */
  showStore?: boolean
  className?: string
}

export function ArtifactIdLine({
  id,
  showStore = false,
  className,
}: ArtifactIdLineProps) {
  return (
    <p className={cn('truncate text-xs text-muted-foreground', className)}>
      {showStore ? artifactIdToWire(id) : id.artifact_local_id}
    </p>
  )
}
