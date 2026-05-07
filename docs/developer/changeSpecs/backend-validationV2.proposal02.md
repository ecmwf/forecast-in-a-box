# Backend validation V2 architecture proposal

## Context and goals

Blueprint validation currently answers one question well: "is this builder complete enough to compile, and what can be appended next?". It is less useful while the user is editing a block configuration, saving a draft, or choosing a block whose valid configuration depends on upstream output shape.

This proposal keeps the same broad ownership boundaries:

- `fiab-core` owns the public contract shared by clients, backend, and plugins.
- `forecastbox.routes.blueprint` owns the HTTP shape exposed to clients.
- `forecastbox.domain.blueprint.service` owns orchestration: glyph resolution, structural checks, type conversion, plugin calls, and expansion aggregation.
- plugins own domain-specific validation, output inference, and input-derived option constraints.

The key design choice is to keep client-submitted `BlockInstance.configuration_values` as raw strings, because they may contain glyph expressions and because drafts may be incomplete. The backend should resolve glyphs and cast to typed Python values before invoking plugins. Plugins should not parse `int`, `datetime`, `list`, or `enum` values from strings themselves.

## Proposed validation model

Validation should become a small pipeline with explicit intent:

1. Structural validation: plugin exists, factory exists, input names match, no extra configuration keys.
2. Glyph validation and rendering: check glyph expression syntax, check referenced glyphs are known, render values against the same intrinsic/global/local glyph sources currently used by `validate_expand`.
3. Core type validation and conversion: validate present rendered values against `BlockConfigurationOption.value_type` and build a typed block instance.
4. Plugin partial validation: optional plugin checks that can run with incomplete configuration.
5. Plugin complete validation: existing output inference, only when the block has all required inputs and required configuration.
6. Expansion and constraints: use valid upstream outputs to list candidate factories and compute input-derived configuration constraints for each candidate.

The service should be non-mutating. Today `validate_expand(..., validate_only=False)` may mutate `BlueprintBuilder` while resolving glyphs. V2 should return rendered/typed previews in the response and leave the request model unchanged.

## fiab-core contract

### Configuration type descriptors

Replace the ad-hoc string language in `BlockConfigurationOption.value_type` with a machine-readable Pydantic union. Keep the field name `value_type` because it describes the same concept.

```python
from pydantic import Field

ConfigScalarKind = Literal["str", "int", "float", "date", "datetime"]

class ConfigurationType(FiabCoreBaseModel):
    kind: Literal["str", "int", "float", "date", "datetime", "list", "enum"]

class ScalarConfigurationType(ConfigurationType):
    kind: ConfigScalarKind

class EnumChoice(FiabCoreBaseModel):
    value: str
    label: str | None = None
    description: str | None = None

class EnumConfigurationType(ConfigurationType):
    kind: Literal["enum"] = "enum"
    choices: list[EnumChoice] = Field(default_factory=list)
    value_type: ScalarConfigurationType = ScalarConfigurationType(kind="str")

class ListConfigurationType(ConfigurationType):
    kind: Literal["list"] = "list"
    item_type: ScalarConfigurationType | EnumConfigurationType
```

Notes:

- `date` is included because the existing ECMWF plugin uses `date-iso8601`; `datetime` remains the general timestamp type from the change spec.
- Lists should use a canonical JSON-array string on the wire, for example `["2t", "msl"]` or `[0, 6, 12]`. The backend can offer client helper examples, but the REST contract should not depend on comma splitting.
- `optional[T]` should not be a type. Optionality is an option-level concern, not a value-level type.

### Block configuration options

Extend `BlockConfigurationOption` so presence/default behavior is explicit and independent of type.

```python
class BlockConfigurationOption(FiabCoreBaseModel):
    title: str
    description: str
    value_type: ConfigurationType
    default_value: str | None = None
    required: bool = True
    is_advanced: bool = False
```

Rules:

- `required=False` means the key may be omitted. If present, it must still type-check.
- `default_value` is a raw wire value and must type-check during catalogue loading.
- A required option with `default_value` may be omitted by the client for draft/prevalidate purposes, but complete validation should inject or apply the default before plugin validation.
- `is_advanced=True` should remain UI metadata only; it must not imply optionality.

`fiab-core` should also provide typed builder helpers for plugin authors, for example:

```python
cfg.str()
cfg.int()
cfg.float()
cfg.date()
cfg.datetime()
cfg.list_of(cfg.str())
cfg.enum(["mars", "opendata", "polytope"])
```

The helpers keep plugin declarations readable and avoid every plugin author constructing nested Pydantic models by hand.

### Typed configuration values

Introduce a typed block instance for plugin-facing calls:

```python
ConfigurationScalarValue = str | int | float | datetime.date | datetime.datetime
ConfigurationValue = ConfigurationScalarValue | list[ConfigurationScalarValue] | None

class TypedBlockInstance(FiabCoreBaseModel):
    factory_id: PluginBlockFactoryId
    configuration_values: dict[str, ConfigurationValue]
    input_ids: dict[str, BlockInstanceId]
```

`BlockInstance` remains the client/backend persistence shape with `dict[str, str]`. `TypedBlockInstance` is produced by backend validation after glyph rendering and type conversion. Plugins receive `TypedBlockInstance` in validation and compilation.

### Validation issues

Replace string-only errors with structured issues. Strings can still appear inside `message`, but clients need stable severity, code, and path fields.

```python
class ValidationIssue(FiabCoreBaseModel):
    severity: Literal["error", "warning"]
    code: str
    message: str
    path: list[str | int] = Field(default_factory=list)

class BlockValidationReport(FiabCoreBaseModel):
    issues: list[ValidationIssue] = Field(default_factory=list)
    option_issues: dict[str, list[ValidationIssue]] = Field(default_factory=dict)
    rendered_values: dict[str, str] = Field(default_factory=dict)
    typed_values: dict[str, ConfigurationValue] = Field(default_factory=dict)

class BlueprintValidationReport(FiabCoreBaseModel):
    global_issues: list[ValidationIssue] = Field(default_factory=list)
    block_issues: dict[BlockInstanceId, BlockValidationReport] = Field(default_factory=dict)
```

The existing `global_errors` and `block_errors` are not expressive enough for `prevalidate`, warnings, or option-level client UI.

### Constraints

Represent input-derived constraints separately from base type declarations. A factory's catalogue says what the option can ever be. Constraints say what makes sense in the current input context.

```python
class ConfigurationOptionConstraint(FiabCoreBaseModel):
    allowed_values: list[EnumChoice] | None = None
    recommended_values: list[EnumChoice] | None = None
    default_value: str | None = None
    issues: list[ValidationIssue] = Field(default_factory=list)

class BlockConfigurationConstraints(FiabCoreBaseModel):
    options: dict[str, ConfigurationOptionConstraint] = Field(default_factory=dict)
```

Semantics:

- `allowed_values` is a hard constraint. Values outside it are errors.
- `recommended_values` is a soft constraint. Values outside it are warnings, not errors.
- `default_value` may narrow or override the catalogue default for this input context.
- Constraints must be subsets of the base type. If a base type is `str`, constraints may provide `allowed_values` to make the current UI a dropdown. If the base type is enum, constraints may narrow its enum values.

This directly addresses the "compatible checkpoints but user may insist" case: use `recommended_values` for compatibility hints and reserve `allowed_values` for values the plugin truly cannot accept.

### Plugin class changes

Change plugin-facing signatures to use typed block instances:

```python
Validator = Callable[
    [TypedBlockInstance, dict[str, BlockInstanceOutput]],
    Either[BlockInstanceOutput, Error],
]

Compiler = Callable[
    [ActionLookup, BlockInstanceId, TypedBlockInstance],
    Either[Action, Error],
]
```

Add two optional extension points:

```python
Prevalidator = Callable[
    [TypedBlockInstance, dict[str, BlockInstanceOutput]],
    BlockValidationReport,
]

ConstraintProvider = Callable[
    [BlockFactoryId, dict[str, BlockInstanceOutput]],
    Either[BlockConfigurationConstraints, Error],
]
```

`Plugin` becomes:

```python
@dataclass(frozen=True, eq=True, slots=True)
class Plugin:
    catalogue: BlockFactoryCatalogue
    validator: Validator
    expander: Expander
    compiler: Compiler
    prevalidator: Prevalidator | None = None
    constraints: ConstraintProvider | None = None
```

Default behavior:

- Missing `prevalidator` means "core structural/type checks only".
- Missing `constraints` means "no additional input-derived constraints".
- `validator` remains complete validation and output inference.
- `expander` remains coarse output-to-factory matching.

For `fiab_core.tools.blocks.QubedBlockBuilder`, add instance methods with defaults:

```python
def prevalidate(
    self,
    block: TypedBlockInstance,
    inputs: dict[str, QubedOutput],
) -> BlockValidationReport:
    return BlockValidationReport()

def configuration_constraints(
    self,
    inputs: dict[str, QubedOutput],
) -> BlockConfigurationConstraints:
    return BlockConfigurationConstraints()
```

`QubedPluginBuilder` should wire these methods into the new `Plugin` extension points. This preserves the simple "declare block classes" plugin style and keeps most plugin authors out of the lower-level `Plugin` dataclass.

## Backend route contract

### `GET /api/v1/blueprint/catalogue`

Keep the route, but change the response schema because `BlockConfigurationOption.value_type` becomes structured.

Suggested route-local response:

```python
class BlueprintCatalogueResponse(FiabBaseModel):
    plugins: dict[PluginCompositeId, BlockFactoryCatalogue]
```

Returning a named wrapper gives room for future metadata such as catalogue version or plugin load timestamp without another breaking response-shape change.

### New `PUT /api/v1/blueprint/prevalidate`

Purpose: validate a draft or preset without requiring all configuration values to be present.

Request:

```python
class BlueprintPrevalidateRequest(FiabBaseModel):
    builder: BlueprintBuilder
```

Response:

```python
class BlueprintPrevalidateResponse(FiabBaseModel):
    validation: BlueprintValidationReport
```

Behavior:

- Does not fail the HTTP request for validation issues; returns 200 with structured issues.
- Flags extra configuration keys, malformed glyph expressions, unknown glyphs, invalid rendered values, and violated hard constraints for values that are present.
- Does not produce missing-required errors for configuration values.
- May produce missing-input errors only for blocks whose configured inputs reference missing block ids; an incomplete draft should not silently contain impossible graph references.
- Does not run complete plugin validation for a block unless the block has all required inputs and all required configuration.

`POST /blueprint/create` and `POST /blueprint/update` should continue to require complete validation. Internally they should call the same validation pipeline with `intent="complete"` and reject only `severity="error"` issues.

### Change `PUT /api/v1/blueprint/expand`

Keep the existing route name because it is already the client helper for "validate this builder and show me what can come next". Change the response to nest validation and expose constrained candidates.

Request remains:

```python
BlueprintBuilder
```

Response:

```python
class ConstrainedBlockFactoryRef(FiabBaseModel):
    factory_id: PluginBlockFactoryId
    constraints: BlockConfigurationConstraints = Field(default_factory=BlockConfigurationConstraints)

class BlueprintExpansionResponse(FiabBaseModel):
    validation: BlueprintValidationReport
    possible_sources: list[ConstrainedBlockFactoryRef]
    possible_expansions: dict[BlockInstanceId, list[ConstrainedBlockFactoryRef]]
```

Behavior:

- Existing blocks are validated with complete intent where possible, because output inference is needed to expand downstream.
- Invalid blocks do not produce expansions.
- Candidate factories are still selected by each plugin's `expander(output)`.
- For each candidate factory, the backend calls that candidate plugin's `constraints(factory_id, inputs)` to derive per-option constraints from upstream outputs.
- Source blocks use an empty input dictionary, so plugins can also constrain source configuration from local artifact/catalogue metadata.

### New `PUT /api/v1/blueprint/block/constraints`

Purpose: fetch constraints for one factory/input mapping while the client is editing a block form. This avoids forcing clients to add a provisional block into the builder just to get option constraints.

Request:

```python
class BlockConstraintsRequest(FiabBaseModel):
    builder: BlueprintBuilder
    factory_id: PluginBlockFactoryId
    input_ids: dict[str, BlockInstanceId]
```

Response:

```python
class BlockConstraintsResponse(FiabBaseModel):
    validation: BlueprintValidationReport
    constraints: BlockConfigurationConstraints
```

Behavior:

- Validates enough of `builder` to compute outputs for the referenced `input_ids`.
- Returns validation issues if upstream blocks are invalid or unavailable.
- Calls the target plugin's `constraints(factory_id, inputs)`.
- Does not require or accept `configuration_values`.

### New `PUT /api/v1/blueprint/block/prevalidate`

Purpose: validate one in-progress block form against base types, glyphs, and current input-derived constraints.

Request:

```python
class BlockPrevalidateRequest(FiabBaseModel):
    builder: BlueprintBuilder
    block: BlockInstance
```

Response:

```python
class BlockPrevalidateResponse(FiabBaseModel):
    validation: BlockValidationReport
    constraints: BlockConfigurationConstraints
```

Behavior:

- Useful before the block is added to `builder.blocks`.
- Resolves the block's glyphs using intrinsic/global/local glyphs from `builder`.
- Computes input-derived constraints from `block.input_ids`.
- Type-checks and casts present configuration values.
- Invokes plugin `prevalidator` with typed values, but not complete `validator` unless the block is complete.

This route is not strictly required if clients are comfortable inserting temporary blocks and calling `/prevalidate`, but it gives a cleaner client flow and keeps the API intent clear.

## Backend service architecture

`forecastbox.domain.blueprint.service` should split the current `validate_expand` into smaller internal functions:

```python
resolve_glyph_context(builder, auth_context) -> GlyphResolutionContext
validate_block_structure(block_id, block, plugins) -> BlockValidationReport
render_block_configuration(block, glyph_context) -> RenderResult
type_convert_block(factory, block, rendered_values, intent) -> TypedBlockResult
prevalidate_block(plugin, typed_block, inputs) -> BlockValidationReport
validate_complete_block(plugin, typed_block, inputs) -> Either[BlockInstanceOutput, ValidationIssue]
constraints_for_factory(plugin, factory_id, inputs) -> BlockConfigurationConstraints
```

Then expose orchestration functions:

```python
async def prevalidate_builder(builder, auth_context) -> BlueprintValidationReport
async def validate_builder_complete(builder, auth_context) -> tuple[BlueprintValidationReport, dict[BlockInstanceId, BlockInstanceOutput]]
async def expand_builder(builder, auth_context) -> BlueprintExpansionResponse
async def block_constraints(request, auth_context) -> BlockConstraintsResponse
async def prevalidate_block(request, auth_context) -> BlockPrevalidateResponse
```

The important separation is that type conversion is core/backend-owned and plugin validation sees typed values. Plugin methods should never receive raw unresolved glyph strings.

`forecastbox.domain.run.compile.compile_builder` should use the same complete-validation conversion path before calling `plugin.compiler`. This avoids a second divergent conversion path where execution behaves differently from create/update validation.

## Plugin examples

### ECMWF parameter constraints

`EnsembleStatistics.param` and `TemporalStatistics.param` currently declare `str` and then check whether the parameter exists in the input `QubedOutput`. In V2:

- Catalogue option remains broad: `value_type=cfg.str()`.
- `configuration_constraints(inputs)` returns `allowed_values` from `axes(input_dataset)["param"]` when the plugin cannot execute missing params.
- Complete `validate` can keep a defensive check and return an error if a caller bypasses constraints.

### Map plot parameters

`MapPlotSink.param` is a list of strings. In V2:

- Catalogue option: `value_type=cfg.list_of(cfg.str())`.
- Wire value: `["2t", "msl"]`.
- Typed plugin value: `list[str]`.
- Constraints: `allowed_values` from the input param axis.
- The core type system validates that the raw value is a JSON array of strings before `MapPlotSink.validate` runs.

### Anemoi checkpoint compatibility

Checkpoint choices are dynamic and can be compatibility hints rather than absolute truth.

- Catalogue may use `cfg.str()` if the list is large or expensive.
- Constraints may return `recommended_values` for locally compatible checkpoints.
- If a checkpoint identifier is syntactically invalid or unknown at execution time, the plugin complete validator still returns an error.

## Error and warning policy

Complete validation should reject only `severity="error"`. Warnings should be returned to clients and may be displayed before saving/running, but they should not block draft save, complete blueprint save, or execution unless the product decision later changes.

Recommended issue codes:

- `plugin.not_found`
- `factory.not_found`
- `input.missing`
- `input.extra`
- `config.extra`
- `config.missing_required`
- `config.glyph.syntax`
- `config.glyph.unknown`
- `config.type.invalid`
- `config.constraint.disallowed`
- `config.constraint.not_recommended`
- `plugin.validation_failed`
- `plugin.constraints_failed`

Stable codes matter more than exact wording. The client should not parse human messages.

## Concerns and pitfalls

### Glyphs and type validation

Glyph rendering happens before type conversion. Known glyphs can be rendered and type-checked. Unknown glyphs should remain errors even in draft validation, because accepting a draft with an unresolved glyph reference makes later behavior surprising.

Runtime intrinsic glyphs are validated using the same example values already exposed by `get_values_and_examples()`. This is acceptable for V2, but it is not a complete type contract for glyphs. A later improvement should add explicit glyph value types so a datetime option can distinguish "this glyph is known to render as datetime" from "this example happened to look valid".

### Lists need a canonical wire format

Current plugins mix comma-separated values and Python lists. V2 should standardize on JSON-array strings for list options at the REST boundary. This is less convenient to type by hand but much less ambiguous for clients, glyph rendering, and nested quoting.

### Constraints must be pure and cheap

`constraints()` must not download artifacts, run workflows, contact slow remote services, or mutate state. It should derive constraints from already-known metadata and upstream `BlockInstanceOutput`. If a plugin needs artifact metadata, it should use cached catalogue/artifact metadata already available to the backend.

### Large enumerations

Enums and constraints should remain small enough for a dropdown. Large checkpoint/model inventories should not be shipped as huge enum lists in every `/expand` response. For large dynamic domains, use `str` plus `recommended_values` only for small compatible subsets, or add a dedicated searchable metadata endpoint later.

### Hard vs soft constraints

Plugin authors may be tempted to put every compatibility hint in `allowed_values`. That would make the UX overly restrictive and prevent expert override. The rule should be: use `allowed_values` only when execution cannot make sense outside the set; use `recommended_values` when the plugin can try but expects a worse or uncertain outcome.

### Avoid double validation drift

Create/update validation, `/prevalidate`, `/expand`, and run compilation must share the same core render-and-convert implementation. Otherwise plugins will see typed values in one path and strings in another, recreating the current problem.

### Partial plugin validation

Existing validators often index required keys directly, for example `block.configuration_values["param"]`. They should not be reused blindly for drafts. `prevalidator` is a separate hook so plugin authors can add checks that are safe with missing values.

### Datetime semantics

`date` and `datetime` parsing must define timezone behavior. Recommended rule: `date` accepts ISO `YYYY-MM-DD`; `datetime` accepts ISO 8601 and normalizes to timezone-aware UTC when a timezone is present. If no timezone is present, preserve a naive `datetime` but return a warning code such as `config.type.datetime_naive` if the option declares that timezone awareness is recommended. Avoid silently interpreting naive datetimes as local time.

### Catalogue load validation

The backend should validate plugin catalogues on plugin load:

- every `value_type` descriptor is well-formed,
- every `default_value` type-checks,
- enum values are unique,
- `allowed_values` returned by constraints are compatible with the base option type.

Bad plugin catalogues should surface through the existing plugin status/error mechanism rather than producing surprising route failures later.

## Summary

The core of V2 is a clear boundary: clients and persistence use raw string configuration values so drafts and glyphs remain natural, while plugins receive typed configuration values produced by a shared backend conversion pipeline. `fiab-core` should define structured type descriptors, validation issues, typed block instances, and option constraints. The blueprint routes should add draft/block prevalidation and block constraint endpoints, and should change `/expand` to return constrained candidate factories rather than just factory ids and string errors.
