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
 * Dynamic Form Fields
 *
 * Components for rendering form fields based on backend value_type metadata.
 */

export {
  FieldRenderer,
  InlineFieldRenderer,
  type FieldRendererProps,
  type InlineFieldRendererProps,
} from './FieldRenderer'

export {
  parseValueType,
  getDefaultValueForType,
  type ParsedValueType,
} from './value-type-parser'

// Individual field components (for custom usage)
export { StringField, type StringFieldProps } from './fields/StringField'
export { NumberField, type NumberFieldProps } from './fields/NumberField'
export { DateTimeField, type DateTimeFieldProps } from './fields/DateTimeField'
export { EnumField, type EnumFieldProps } from './fields/EnumField'
export { ListField, type ListFieldProps } from './fields/ListField'
