/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Suspense, lazy, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronsUpDown } from 'lucide-react'
import countriesData from '../data/countries.json'
import { EnumListField } from './EnumListField'
import { StringField } from './StringField'
import {
  AUTO_DOMAIN,
  PRESET_DOMAINS,
  detectMode,
  isAutoDomain,
  parseBbox,
  serializeNames,
  tokenize,
} from './geo-domain'
import type { GeoDomainMode } from './geo-domain'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useFieldErrors } from '@/features/fable-builder/context/BlockValidationContext'
import { containsGlyphs } from '@/features/fable-builder/utils/glyph-display'
import { cn } from '@/lib/utils'

// Map is heavy (OpenLayers + country polygons); only loaded when the Map tab is opened.
const GeoDomainMap = lazy(() => import('./GeoDomainMap'))

const COUNTRY_NAMES: ReadonlyArray<string> = countriesData.map(
  (c) => c.name_long,
)

export interface GeoDomainFieldProps {
  id: string
  configKey: string
  /** Comma-separated geodomain value (names or a `west,south,east,north` bbox). */
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function GeoDomainField({
  id,
  configKey,
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: GeoDomainFieldProps) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [mode, setMode] = useState<GeoDomainMode>(() =>
    detectMode(value, PRESET_DOMAINS, COUNTRY_NAMES),
  )

  const bbox = useMemo(() => parseBbox(value), [value])
  const tokens = useMemo(() => tokenize(value), [value])
  const isAuto = isAutoDomain(value)
  const selectedPreset = useMemo(() => {
    const lower = value.trim().toLowerCase()
    return (
      PRESET_DOMAINS.find((preset) => preset.toLowerCase() === lower) ?? null
    )
  }, [value])

  const fieldErrors = useFieldErrors()?.[configKey] ?? null
  const hasError = fieldErrors !== null && fieldErrors.length > 0
  const errorMessage = hasError
    ? fieldErrors.length > 1
      ? `${fieldErrors[0]} (+${fieldErrors.length - 1} more)`
      : fieldErrors[0]
    : null

  // Re-pick the active tab from the current value each time the picker opens; collapse on close.
  const handleOpenChange = (next: boolean) => {
    if (next) setMode(detectMode(value, PRESET_DOMAINS, COUNTRY_NAMES))
    else setExpanded(false)
    setOpen(next)
  }

  return (
    <div>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              variant="outline"
              disabled={disabled}
              aria-invalid={hasError}
              className={cn(
                'h-9 w-full justify-between gap-2 font-normal',
                hasError && 'border-destructive',
                className,
              )}
            />
          }
        >
          <span className="min-w-0 flex-1 truncate text-left text-sm">
            <TriggerSummary
              value={value}
              bbox={bbox}
              tokens={tokens}
              placeholder={t('geoDomain.placeholder')}
              autoLabel={t('geoDomain.autoLabel')}
              boxLabel={(b) =>
                t('geoDomain.boxSummary', {
                  west: b[0],
                  south: b[1],
                  east: b[2],
                  north: b[3],
                })
              }
            />
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className={cn(
            // Compact: match the trigger (sidebar) width so the popover never spills over the
            // sidebar. Expanded: grow wider for the map, but never past the viewport.
            'p-0 transition-[width] duration-200',
            expanded
              ? 'w-[44rem] max-w-(--available-width)'
              : 'w-(--anchor-width)',
          )}
        >
          <Tabs
            value={mode}
            onValueChange={(next) => setMode(next as GeoDomainMode)}
          >
            <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0">
              <TabsTrigger value="presets">
                {t('geoDomain.tabPresets')}
              </TabsTrigger>
              <TabsTrigger value="countries">
                {t('geoDomain.tabCountries')}
              </TabsTrigger>
              <TabsTrigger value="bbox">{t('geoDomain.tabMap')}</TabsTrigger>
              <TabsTrigger value="raw">
                {t('geoDomain.tabAdvanced')}
              </TabsTrigger>
            </TabsList>

            <div className="p-3">
              <TabsContent value="presets" className="mt-0">
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={isAuto ? 'default' : 'outline'}
                    className="h-7 font-normal"
                    disabled={disabled}
                    title={t('geoDomain.autoHint')}
                    onClick={() => onChange(isAuto ? '' : AUTO_DOMAIN)}
                  >
                    {t('geoDomain.autoLabel')}
                  </Button>
                  {PRESET_DOMAINS.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      size="sm"
                      variant={
                        selectedPreset === preset ? 'default' : 'outline'
                      }
                      className="h-7 font-normal"
                      disabled={disabled}
                      onClick={() =>
                        onChange(
                          selectedPreset === preset
                            ? ''
                            : serializeNames([preset]),
                        )
                      }
                    >
                      {preset}
                    </Button>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="countries" className="mt-0">
                {/* Reuse the enum multi-select; non-country tokens (presets/bbox) simply show as
                    nothing selected, so picking countries replaces the value. */}
                <EnumListField
                  id={`${id}-countries`}
                  configKey={configKey}
                  value={value}
                  onChange={onChange}
                  options={COUNTRY_NAMES}
                  placeholder={t('geoDomain.searchCountries')}
                  disabled={disabled}
                />
              </TabsContent>

              <TabsContent value="bbox" className="mt-0">
                <Suspense
                  fallback={
                    <div className="flex h-56 items-center justify-center">
                      <Spinner />
                    </div>
                  }
                >
                  <GeoDomainMap
                    value={value}
                    onChange={onChange}
                    countryNames={COUNTRY_NAMES}
                    expanded={expanded}
                    onToggleExpand={() => setExpanded((prev) => !prev)}
                    disabled={disabled}
                  />
                </Suspense>
              </TabsContent>

              <TabsContent value="raw" className="mt-0 space-y-1.5">
                {/* StringField brings the glyph toggle: switch between manual text and ${variables}. */}
                <StringField
                  id={`${id}-raw`}
                  configKey={configKey}
                  value={value}
                  onChange={onChange}
                  placeholder={placeholder}
                  disabled={disabled}
                />
                <p className="text-xs text-muted-foreground">
                  {t('geoDomain.advancedHint')}
                </p>
              </TabsContent>
            </div>
          </Tabs>
        </PopoverContent>
      </Popover>
      {errorMessage && (
        <p className="mt-1 truncate text-xs text-destructive">{errorMessage}</p>
      )}
    </div>
  )
}

function TriggerSummary({
  value,
  bbox,
  tokens,
  placeholder,
  autoLabel,
  boxLabel,
}: {
  value: string
  bbox: ReturnType<typeof parseBbox>
  tokens: Array<string>
  placeholder: string
  autoLabel: string
  boxLabel: (bbox: NonNullable<ReturnType<typeof parseBbox>>) => string
}) {
  // Single-line summary; the parent span truncates with an ellipsis when it overflows.
  if (isAutoDomain(value)) return <>{autoLabel}</>
  if (bbox) return <>{boxLabel(bbox)}</>
  if (containsGlyphs(value)) return <code className="text-xs">{value}</code>
  if (tokens.length > 0) return <>{tokens.join(', ')}</>
  return <span className="text-muted-foreground">{placeholder}</span>
}
