/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Catalogue picker for `artifact` options (all models without `options`). */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { GlyphFieldWrapper } from './GlyphFieldWrapper'
import type { ArtifactInfo } from '@/api/types/artifacts.types'
import { artifactIdToWire, artifactLabels } from '@/api/types/artifacts.types'
import { useArtifacts } from '@/api/hooks/useArtifacts'
import { ArtifactCompatibilityBadge } from '@/features/artifacts/components/ArtifactCompatibilityBadge'
import { containsGlyphs } from '@/features/fable-builder/utils/glyph-display'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export interface ArtifactFieldProps {
  id: string
  configKey: string
  value: string
  onChange: (value: string) => void
  /** Wire ids the option is restricted to; omit for the whole catalogue. */
  options?: Array<string>
  placeholder?: string
  disabled?: boolean
  className?: string
}

interface Choice {
  wireId: string
  artifact: ArtifactInfo | null
}

export function ArtifactField({
  id,
  configKey,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
}: ArtifactFieldProps) {
  const { t } = useTranslation('common')
  const { artifacts } = useArtifacts()
  const resolvedPlaceholder = placeholder ?? t('field.selectPlaceholder')
  const labels = useMemo(() => artifactLabels(artifacts), [artifacts])

  const choices = useMemo<Array<Choice>>(() => {
    const byWireId = new Map(artifacts.map((a) => [artifactIdToWire(a.id), a]))
    // Declared order; unknown ids stay so saved values never vanish.
    const wireIds = options ?? [...byWireId.keys()]
    const list = wireIds.map((wireId) => ({
      wireId,
      artifact: byWireId.get(wireId) ?? null,
    }))
    if (value && !wireIds.includes(value) && !containsGlyphs(value)) {
      list.unshift({ wireId: value, artifact: byWireId.get(value) ?? null })
    }
    return list
  }, [artifacts, options, value])
  // One shared store: show local ids only.
  const singleStore =
    new Set(choices.map(({ wireId }) => wireId.split(':')[0])).size <= 1

  return (
    <GlyphFieldWrapper
      id={id}
      configKey={configKey}
      value={value}
      onChange={onChange}
      placeholder={resolvedPlaceholder}
      disabled={disabled}
      className={className}
      selfContainedChild
    >
      <Select
        value={value || null}
        onValueChange={(next) => onChange(next ?? '')}
        itemToStringLabel={(wireId: string) => labels.get(wireId) ?? wireId}
        disabled={disabled}
      >
        <SelectTrigger id={id} className={cn('w-full', className)}>
          <SelectValue placeholder={resolvedPlaceholder} />
        </SelectTrigger>
        <SelectContent className="w-auto max-w-md min-w-(--anchor-width)">
          {choices.map(({ wireId, artifact }) => (
            <SelectItem key={wireId} value={wireId}>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">
                    {artifact?.displayName ?? wireId}
                  </span>
                  {/* Restricted lists are pre-filtered to compatible. */}
                  {artifact && !artifact.isLocallyCompatible && (
                    <ArtifactCompatibilityBadge
                      artifact={artifact}
                      className="shrink-0 px-1.5 text-xs"
                    />
                  )}
                  {artifact && artifact.diskSize !== '-' && (
                    <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground tabular-nums">
                      {artifact.diskSize}
                    </span>
                  )}
                </span>
                {artifact && (
                  <span className="truncate text-xs text-muted-foreground">
                    {singleStore ? artifact.id.artifact_local_id : wireId}
                  </span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </GlyphFieldWrapper>
  )
}
