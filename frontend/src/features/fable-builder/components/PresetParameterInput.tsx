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
 * PresetParameterInput
 *
 * Renders the appropriate input control for a single `PresetParameter` based
 * on its `value_type` string. Delegates all type-parsing and widget selection
 * to the existing `FieldRenderer` / `parseValueType` infrastructure so the
 * two surfaces stay in sync automatically.
 *
 * Supported value_type strings (via parseValueType):
 *   enumClosed[a,b,c]  → Select dropdown
 *   str / string        → Text input
 *   int / integer       → Integer numeric input
 *   float / number      → Decimal numeric input
 *   date / date-iso8601 → Date picker
 *   datetime            → Date + time picker
 *   list[str|int]       → Tag / chip list input
 *   list[enumClosed[…]] → Multi-select combobox
 *
 * Outside the fable-builder tree the GlyphContext defaults to [] and
 * BlockValidationContext defaults to null — GlyphFieldWrapper therefore
 * renders the concrete widget directly with no glyph-mode toggle, which is
 * the correct behaviour for the preset wizard.
 */

import { useCallback } from 'react'
import type { PresetParameter } from '@/api/types/preset.types'
import { FieldRenderer } from '@/components/base/fields/FieldRenderer'

export interface PresetParameterInputProps {
  parameter: PresetParameter
  /** Current controlled value (parent seeds this with `parameter.default_value`). */
  value: string
  /** Called with the parameter's glyph_key and the new string value. */
  onChange: (glyphKey: string, value: string) => void
}

export function PresetParameterInput({
  parameter,
  value,
  onChange,
}: PresetParameterInputProps) {
  const handleChange = useCallback(
    (newValue: string) => {
      onChange(parameter.glyph_key, newValue)
    },
    [onChange, parameter.glyph_key],
  )

  return (
    <FieldRenderer
      id={`preset-param-${parameter.glyph_key}`}
      configKey={parameter.glyph_key}
      valueType={parameter.value_type}
      value={value}
      onChange={handleChange}
      label={parameter.label}
      description={parameter.description}
    />
  )
}
