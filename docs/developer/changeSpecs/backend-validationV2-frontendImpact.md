# Backend Validation V2 frontend impact

This file is the frontend-facing changelog for backend Validation V2 tasks. Backend implementation PRs that alter route schemas, response payloads, catalogue values, or validation semantics should update the relevant section with the final shape and examples.

Frontend code does not need to be read or modified as part of these backend tasks.

## Task 1: ConfigurationOptionId

Expected frontend impact: none.

The JSON representation of configuration option keys should remain strings. This task is a backend/core typing improvement only.

## Task 2: FableType

Expected frontend impact: none unless documentation exposes the accepted type syntax early.

`BlockConfigurationOption.value_type` should still serialize as a string. `FableType` is introduced but not yet used by plugins or backend route behavior.

## Task 3: Plugin FableType migration

Expected frontend impact: possible catalogue value changes.

Affected route:

- `GET /blueprint/catalogue`

The value of `configuration_options.*.value_type` changes to the canonical `FableType` syntax. Catalogue-level backward compatibility is not required.

Example before:

```json
{
  "configuration_options": {
    "statistic": {
      "value_type": "enum['mean', 'std']"
    }
  }
}
```

Example after:

```json
{
  "configuration_options": {
    "statistic": {
      "value_type": "enumClosed['mean', 'std']"
    }
  }
}
```

Exact catalogue migrations in this implementation:

| Catalogue field | Before | After |
| --- | --- | --- |
| `fiab-plugin-test.source_filesize.checkpoint` | `enum['mystore:mycheckpoint']` | `enumClosed['mystore:mycheckpoint']` |
| `fiab-plugin-ecmwf.EkdSource.source` | `enum['mars', 'ecmwf-open-data']` | `enumClosed['mars', 'ecmwf-open-data']` |
| `fiab-plugin-ecmwf.EkdSource.date` | `date-iso8601` | `date` |
| `fiab-plugin-ecmwf.AnemoiSource.checkpoint` | `enum['<checkpoint ids>']` | `enumClosed['<checkpoint ids>']` |
| `fiab-plugin-ecmwf.AnemoiSource.input_source` | `enum['mars', 'opendata', 'polytope']` | `enumClosed['mars', 'opendata', 'polytope']` |
| `fiab-plugin-ecmwf.AnemoiSource.ensemble_members` | `optional[int]` | `int` |
| `fiab-plugin-ecmwf.EnsembleStatistics.statistic` | `enum['mean', 'std']` | `enumClosed['mean', 'std']` |
| `fiab-plugin-ecmwf.TemporalStatistics.statistic` | `enum['mean', 'std', 'min', 'max']` | `enumClosed['mean', 'std', 'min', 'max']` |
| `fiab-plugin-ecmwf.MapPlotSink.format` | `enum['png', 'pdf', 'svg']` | `enumClosed['png', 'pdf', 'svg']` |

`list[int]` remains unchanged.

## Task 4: Backend conversion

Expected frontend impact: validation behavior changes, but no route shape change.

Affected routes:

- `PUT /blueprint/expand`
- `POST /blueprint/create`
- `POST /blueprint/update`
- Any run submission path that compiles a blueprint

Invalid type values should be rejected by the backend before plugin validation/compilation. Frontend clients should expect type conversion errors in the existing error containers rather than plugin-specific error strings.

Example before:

```json
{
  "block_errors": {
    "transform_increment": ["plugin-specific int parsing error"]
  }
}
```

Example after:

```json
{
  "block_errors": {
    "transform_increment": ["Invalid value for configuration option 'amount': expected int"]
  }
}
```

The exact message is implementation-defined; the frontend should not parse the text.

*Unplanned:* values are now converted from strings only. Clients that send non-string JSON values in `configuration_values` (for example, numeric JSON literals instead of `"1"`) now get conversion/type errors during backend validation.

## Task 5: Missing values during validation

Expected frontend impact: validation semantics change, no new field.

Affected routes:

- `PUT /blueprint/expand`
- `POST /blueprint/create`
- `POST /blueprint/update`

During validation, missing configuration options should no longer appear in `block_errors` merely because they are missing. Compilation should still fail for missing required options.

Example before:

```json
{
  "block_errors": {
    "source_text": ["Block contains missing config: {'text'}"]
  }
}
```

Example after:

```json
{
  "block_errors": {}
}
```

The frontend remains responsible for warning users that required values are empty or missing.

## Task 6: BlockExpansion contract

Expected frontend impact: `PUT /blueprint/expand` response shape changes.

Affected route:

- `PUT /blueprint/expand`

`possible_expansions` continues to be keyed by block instance id. Each expansion item now includes plugin id, factory id, and restrictions.

Example before:

```json
{
  "possible_expansions": {
    "source_42": [
      {
        "plugin": {"store": "local", "local": "test"},
        "factory": "transform_increment"
      }
    ]
  }
}
```

Example after:

```json
{
  "possible_expansions": {
    "source_42": [
      {
        "plugin": {"store": "local", "local": "test"},
        "factory": "transform_increment",
        "restrictions": {}
      }
    ]
  }
}
```

## Task 7: Test plugin restrictions

Expected frontend impact: existing response field starts carrying non-empty restrictions.

Affected route:

- `PUT /blueprint/expand`

When expanding a `source_42` (int-producing) block, the `transform_increment` expansion now
carries a non-empty `restrictions` map. The `amount` configuration option is restricted to
`enumClosed[1,2,3]` to demonstrate the full backend-to-route flow.

Example after task 7 (the `source_42` block expands to `transform_increment` with a restriction):

```json
{
  "possible_expansions": {
    "source_42": [
      {
        "plugin": {"store": "localTest", "local": "single"},
        "factory": "transform_increment",
        "restrictions": {
          "amount": "enumClosed[1,2,3]"
        }
      },
      {
        "plugin": {"store": "localTest", "local": "single"},
        "factory": "product_join",
        "restrictions": {}
      }
    ]
  }
}
```

The response field names are `plugin`, `factory`, and `restrictions`.

## Task 8: Missing glyph warnings

Expected frontend impact: `PUT /blueprint/expand` response gains `missing_glyphs`.

Affected route:

- `PUT /blueprint/expand`

Unknown glyph references should not appear as hard validation errors during validation. They should be returned in a new field:

```python
missing_glyphs: dict[BlockInstanceId, dict[ConfigurationOptionId, list[str]]]
```

Example before:

```json
{
  "block_errors": {
    "sink_file": ["Unknown glyphs referenced: {'missingRoot'}"]
  }
}
```

Example after:

```json
{
  "block_errors": {},
  "missing_glyphs": {
    "sink_file": {
      "fname": ["missingRoot"]
    }
  }
}
```

Malformed glyph expressions remain hard errors and should still be shown through `block_errors`.

Because unknown glyph references are now soft validation warnings, `POST /blueprint/create` and `POST /blueprint/update` no longer reject those cases via `block_errors`. Those endpoints currently do not return `missing_glyphs`, so this warning detail is only surfaced by `PUT /blueprint/expand`.
