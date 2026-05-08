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

`possible_expansions` should continue to be keyed by block instance id, but each expansion item should include both the target block factory and configuration option restrictions.

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
        "block_factory_id": {
          "plugin": {"store": "local", "local": "test"},
          "factory": "transform_increment"
        },
        "configuration_option_restrictions": {}
      }
    ]
  }
}
```

The field names are proposed, not final. The implementation PR for task 6 must update this section with the actual serialized names.

## Task 7: Test plugin restrictions

Expected frontend impact: existing response field starts carrying non-empty restrictions.

Affected route:

- `PUT /blueprint/expand`

Task 7 should add at least one integration-test-visible example where `configuration_option_restrictions` is non-empty.

Example after task 7:

```json
{
  "possible_expansions": {
    "source_weather": [
      {
        "block_factory_id": {
          "plugin": {"store": "local", "local": "test"},
          "factory": "map_plot"
        },
        "configuration_option_restrictions": {
          "param": "enumClosed['2t']"
        }
      }
    ]
  }
}
```

The concrete factory ids and type strings should be updated by the implementation PR.

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
