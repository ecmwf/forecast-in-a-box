# Goal
Pydantic → dhi migration

# What dhi is and isn't

dhi (v1.1.21+, on PyPI) is a Pydantic v2-compatible validation library backed by Zig. Its public API is largely identical: BaseModel, Field, model_dump(), model_validate(),
model_fields, ConfigDict, @model_validator, @field_validator, UUID4, SecretStr, PositiveInt, ValidationError, nested models, Union/Optional/Literal — all supported.

Three features dhi explicitly does not support:

 1. BeforeValidator / PlainSerializer / AfterValidator — these annotated type wrappers don't exist; the replacement is @field_validator(mode='before') and custom model_dump()
overrides.
 2. BaseSettings — dhi is a data-validation library, not a settings-management one. pydantic-settings is a separate package and has no dhi equivalent.
 3. model_rebuild() — not mentioned anywhere in the dhi API; needed for recursive model forward-reference resolution.

Additionally, dhi's FieldInfo exposes constraint metadata (ge, le, description, etc.) but Pydantic's FieldInfo has additional attributes — serialization_alias, alias, exclude,
default_factory, json_schema_extra, and the method is_required() — that are used by the codebase for introspection.

# Summary

┌──────────────────────────────┬──────────────┬──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              │ Files        │ Blocked by                                                                                                                       │
├──────────────────────────────┼──────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Trivial (import swap)        │ 7            │ —                                                                                                                                │
├──────────────────────────────┼──────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Minor (small code change)    │ 5            │ —                                                                                                                                │
├──────────────────────────────┼──────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Uncertain (model_rebuild)    │ 2            │ Need to test dhi forward-ref handling                                                                                            │
├──────────────────────────────┼──────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Blocked                      │ 2 src + 1    │ pydantic_settings (no dhi equivalent), BeforeValidator/PlainSerializer (need rewrite), Pydantic introspection API in             │
│                              │ test         │ from_pydantic.py                                                                                                                 │
└──────────────────────────────┴──────────────┴──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

The two blocked source files are config.py and rjsf/from_pydantic.py. They are both foundational: config.py is imported everywhere and bootstraps the entire application;
from_pydantic.py is the bridge between the data model layer and the frontend form-generation system, and it is inherently Pydantic-specific by design.

Practical recommendation: a partial migration is realistic — migrate Tiers 1–2 freely, resolve model_rebuild() empirically, but keep pydantic and pydantic-settings as explicit
dependencies for config.py and the rjsf/ subsystem. A full removal of Pydantic would require replacing the settings infrastructure (non-trivial) and rewriting from_pydantic.py
against dhi's introspection API (feasible only if dhi exposes FieldInfo.default_factory, alias, is_required(), and json_schema_extra).
