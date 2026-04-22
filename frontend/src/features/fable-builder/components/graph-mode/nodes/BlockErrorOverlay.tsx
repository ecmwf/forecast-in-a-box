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
 * Floating validation-error banner shown below a graph-node card. Absolute
 * so toggling errors doesn't resize the node and trigger a React Flow
 * relayout; shared between BlockNode and InlineBlockNode.
 */

import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'

export function BlockErrorOverlay({
  errors,
}: {
  errors: ReadonlyArray<string>
}) {
  if (errors.length === 0) return null
  return (
    <Alert
      variant="destructive"
      className="nodrag absolute top-full right-0 left-0 z-10 mt-1 gap-1 px-2 py-1.5 text-xs shadow-md"
    >
      <AlertCircle className="h-3 w-3" />
      <AlertDescription className="line-clamp-2 text-xs">
        {errors[0]}
        {errors.length > 1 && ` (+${errors.length - 1} more)`}
      </AlertDescription>
    </Alert>
  )
}
