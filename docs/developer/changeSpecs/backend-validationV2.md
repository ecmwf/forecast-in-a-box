# User Stories
The current validation of blueprints works well for a scenario "blueprint is completely ready for a compliation or for an expansion with a next block", but lacks other convenient features, in particular:
* `prevalidate` -- I want to save a config as a preset or as a draft. I haven't yet filled all values so the configuration is not strictly valid, but I don't want to accept any outright invalid values, so I do want _some_ validation to happen.
* `constrained_expand` -- when I expand, not all configuration values make sense: for example, if the input provides only `2t` variables, then the "variables" configuration option in my block obviously would accept only that value. We thus want to run a validate-like action with no user configuration to derive what constraints on all configuration options are placed by the inputs
* `client_type_understanding` -- blocks declare types of configuration options, and frontend should be able to do a full validation / completion of those. This should take into account the typesfrom `constrained_expand`, and should cooperate with glyphs
* `plugin_type_casting` -- the block factories in plugins declare the types of configuration options, but receive all actual values as strings, not as the types. We won't be able to coerce the type statically, but we can handle all the runtime conversion (datetimes, lists, ...).

# Solutions
## Type System Discussion
We need a Type System, in particular:
* a set of permissible values in the `value_type` field of a BlockConfigurationOption, where each:
  * defines a `validate_convert(value: str) -> Either[Any, str]`
  * allows for javascript-based validation
* contains at least:
  * primitives: int, str, float
  * containers: list[T]
  * datetime
  * a support for enumerations or restricted choices

NOTE: In some situations, the enumeration is in theory not a hard constraint -- the plugin may provide a list of compatible checkpoints, but if the user insists, it may allow an execution with an incompatible one. Do we separate errors and warnings?

## Non-Goals
* pandera/pydantic-like system of validations, with like numerical or temporal constraints. Constraints like "date1 > date2", or "int1 is a Mersenne prime" are *not* to be supported by the type system, but are instead handled by the plugin. The belongs-to-enumeration is arguably an exception, and we use it only for small sets where a drop-down makes UI sense. Thus the condition "0 < i < 2048" is _not_ a type, but block internal validation.
