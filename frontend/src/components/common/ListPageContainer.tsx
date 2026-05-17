/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Page shell for list/detail pages — honours the boxed/full layout setting. */

import type { ReactNode } from 'react'
import { useUiStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'

interface ListPageContainerProps {
  children: ReactNode
  className?: string
}

export function ListPageContainer({
  children,
  className,
}: ListPageContainerProps) {
  const layoutMode = useUiStore((state) => state.layoutMode)
  return (
    <div
      className={cn(
        'mx-auto space-y-8 px-4 py-8 sm:px-6 lg:px-8',
        layoutMode === 'boxed' ? 'max-w-7xl' : 'max-w-none',
        className,
      )}
    >
      {children}
    </div>
  )
}
