/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Model-run picker: Latest (server default) or one advertised run. */

import { CalendarClock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatStep } from '../format'
import { RUN_DIMENSION, dimensionValues } from '../wms-capabilities'
import { SLOT_CHIP_CLASS } from './GeoLayerBrowser'
import { LayerControlLabel } from './LayerControlLabel'
import type { ParsedLayer } from '../wms-capabilities'
import type { SourceSlot } from './layer-pairing'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

const LATEST = ''

export function LayerRunSelect({
  slot,
  layer,
  title,
  value,
  onChange,
  showSlot,
}: {
  slot: SourceSlot
  layer: ParsedLayer
  title: string
  /** Pinned run (raw advertised value); null = latest. */
  value: string | null
  onChange: (run: string | null) => void
  showSlot: boolean
}) {
  const { t } = useTranslation('visualise')
  const runs = dimensionValues(layer, RUN_DIMENSION)
  if (runs.length < 2) return null
  const latest = layer.dimensions?.find(
    (d) => d.name === RUN_DIMENSION,
  )?.default
  const label = (run: string) => formatStep(run)
  return (
    <div className="mt-2 flex items-center gap-1.5">
      {showSlot && (
        <span
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold',
            SLOT_CHIP_CLASS[slot],
          )}
        >
          {slot.toUpperCase()}
        </span>
      )}
      <LayerControlLabel
        icon={CalendarClock}
        label={t('sidebar.run')}
        help={t('sidebar.runHelp')}
        helpAria={t('sidebar.runHelpAria')}
      />
      <Select
        value={value ?? LATEST}
        onValueChange={(run) =>
          onChange(typeof run === 'string' && run !== LATEST ? run : null)
        }
      >
        <SelectTrigger
          size="sm"
          className="h-6 min-w-0 flex-1 text-xs"
          aria-label={t('sidebar.runPicker', { name: title })}
        >
          {/* Base UI would show the raw value. */}
          <SelectValue>
            {value
              ? label(value)
              : latest
                ? t('sidebar.runLatest', { time: label(latest) })
                : t('sidebar.run')}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-80 min-w-[220px]">
          <SelectItem value={LATEST} className="text-xs">
            {latest
              ? t('sidebar.runLatest', { time: label(latest) })
              : t('sidebar.run')}
          </SelectItem>
          {[...runs].reverse().map((run) => (
            <SelectItem key={run} value={run} className="font-mono text-xs">
              {label(run)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
