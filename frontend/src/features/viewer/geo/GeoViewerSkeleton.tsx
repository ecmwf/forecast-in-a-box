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
 * Viewer-shaped loading placeholder — real layout in pulsing blocks, so
 * content fills in instead of swapping a spinner. Serves the Suspense
 * fallback and capabilities loading; must stay OpenLayers-free.
 */

import { Skeleton } from '@/components/ui/skeleton'

function SidebarSkeleton() {
  return (
    <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-hidden rounded-md border border-border bg-background p-3 max-lg:hidden">
      <Skeleton className="h-4 w-28" />
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded-sm" />
          <Skeleton className="h-4" style={{ width: `${68 - i * 7}%` }} />
        </div>
      ))}
    </aside>
  )
}

export function GeoViewerSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="flex h-full min-h-0 flex-col gap-2"
    >
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-7 w-24" />
        <Skeleton className="ml-auto h-7 w-20" />
        <Skeleton className="h-7 w-7" />
      </div>
      <div className="flex min-h-0 flex-1 gap-2">
        <SidebarSkeleton />
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border border-border bg-muted/20">
          <Skeleton className="absolute inset-0 rounded-none bg-muted/50" />
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            {label}
          </div>
        </div>
        <SidebarSkeleton />
      </div>
      <div className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-3">
        <Skeleton className="h-7 w-7" />
        <Skeleton className="h-2 flex-1 rounded-full" />
        <Skeleton className="h-4 w-16" />
      </div>
    </div>
  )
}
