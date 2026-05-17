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
 * relayout; used by BlockNode.
 */

import { useState } from 'react'
import { AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'

export function BlockErrorOverlay({
  errors,
}: {
  errors: ReadonlyArray<string>
}) {
  const { t } = useTranslation('configure')
  const [expanded, setExpanded] = useState(false)
  if (errors.length === 0) return null

  const hasMore = errors.length > 1

  function toggle(event: React.MouseEvent | React.KeyboardEvent) {
    event.stopPropagation()
    setExpanded((value) => !value)
  }

  return (
    <Alert
      variant="destructive"
      className="nodrag absolute top-full right-0 left-0 z-10 mt-1 gap-1 px-2 py-1.5 shadow-md"
    >
      <AlertCircle className="h-3 w-3" />
      <AlertDescription className="text-xs">
        {expanded ? (
          <ul className="m-0 list-disc space-y-0.5 pl-4">
            {errors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        ) : (
          <>
            <span className="line-clamp-2">{errors[0]}</span>
            {hasMore && (
              <span className="opacity-80">
                {' '}
                {t('errors.more', { count: errors.length - 1 })}
              </span>
            )}
          </>
        )}
      </AlertDescription>
      <button
        type="button"
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') toggle(event)
        }}
        aria-expanded={expanded}
        aria-label={
          expanded
            ? t('errors.collapseAriaLabel')
            : t('errors.expandAriaLabel', { count: errors.length })
        }
        className="-mr-1 ml-auto flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-destructive/15"
      >
        {expanded ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
      </button>
    </Alert>
  )
}
