# Codebase Review Against backend/development.md

This document records misalignments found between the current codebase and the
developer guidelines in `backend/development.md`. Each section is a self-contained
task suitable for a developer or agent.

---

## Task 1: Complete Dataclass Decorator Arguments

**Guideline reference:**
> for simple immutable data transfer objects, use `@dataclass(frozen=True, eq=True, slots=True)`
> directly for best type checker support -- provides immutability, hashability, and memory
> efficiency via slots. We set `eq=True` explicitly, despite being a default, for clarity.

This holds only plain value types and should be made fully frozen:

- `backend/packages/fiab-core/src/fiab_core/artifacts.py:106`
  `ArtifactResolved` uses bare `@dataclass` -- missing `frozen=True, eq=True, slots=True`

**Fix:** Change each decorator to `@dataclass(frozen=True, eq=True, slots=True)`. For
`PlatformInfo`, verify nothing mutates the fields after construction (nothing does in the
current code).

## Task 6: Pydantic BaseModel Used Directly Without Comment (utility/rsjf)

**Guideline reference:**
> when using pydantic, use `FiabBaseModel` from `forecastbox.utility.pydantic` ... instead
> of `pydantic.BaseModel` directly, unless the model requires dynamic field handling
> (e.g., `extra="allow"` for JSON Schema types). ... If you need the dynamic model
> handling, mark it clearly with a comment.

- `backend/src/forecastbox/utility/rsjf/jsonSchema.py:20`
  `class BaseSchema(BaseModel):` with the comment `# NOTE we need dynamicity, cant use
  FiabBaseModel` -- the comment exists and is correctly placed. This is **compliant** and
  serves as the reference pattern for other files.

No other `pydantic.BaseModel` direct uses were found in the main backend without a
justifying comment. This task is a **verification reminder**: any future `BaseModel`
direct use must include an equivalent comment. The rsjf module is the canonical example.

No code changes are required for this task; it exists to document the current state and
set the baseline for reviewers.
