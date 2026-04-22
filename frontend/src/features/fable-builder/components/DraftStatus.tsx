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
 * Figma-style subtle status line reporting on the LOCAL draft autosave only.
 *
 *   - isDirty && draftWritePending → "Saving draft…"
 *   - isDirty && !draftWritePending → "Draft saved"
 *   - !isDirty                     → nothing
 *
 * Backend-save state lives on the Save Config button variant (primary when
 * dirty, outline when clean). Keeping the two concerns visually separate
 * avoids the "Saving draft… → Unsaved" flip we had when one indicator tried
 * to express both.
 */

import { Check, Loader2 } from 'lucide-react'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { cn } from '@/lib/utils'

export function DraftStatus({ className }: { className?: string }) {
  const isDirty = useFableBuilderStore((s) => s.isDirty)
  const draftWritePending = useFableBuilderStore((s) => s.draftWritePending)

  if (!isDirty) return null

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs text-muted-foreground',
        className,
      )}
    >
      {draftWritePending ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving draft…
        </>
      ) : (
        <>
          <Check className="h-3 w-3" />
          Draft saved
        </>
      )}
    </span>
  )
}
