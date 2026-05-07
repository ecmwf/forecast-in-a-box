# The Type System
* `value_type` is of type FableType, which is a string with strict validation:
    - int, str, float
    - date, datetime # with a single chosen fmt string for each
    - list[FableType]
    - enumClosed[..]
    - enumOpen[..]
* there is `validate_convert(value_type: FableType, value: str) -> Either[Any, str]`, which converts or raises
    * for str and enumOpen the convert is a no-op, for enumClose it validates set-membership
    * for other types it parses and converts

# Contract Changes
The `expand` contract of plugin broadens: instead of list[BlockFactoryId], we return list[BlockExpansion], where BlockExpansion is a dataclass with BlockFactoryId and ConfigurationOptionRestriction: a dict[str, FableType], where str are ConfigurationOption keys (TODO replace str with ConfigurationOptionId NewType) from the underlying BlockFactory, and FableType is a replacement of the original FableType (presumably a restriction, but is not validated/enforced).

Before the `validate` and `compile`, the backend manipulates the configuration values in the BlockInstance, replacing them with the result of validate_convert
    * if the type validation fails, the plugin is *not* called at all, and only the type errors are collected and provided to the caller
    * if a value is *missing*: for validation, this does not cause an issue -- the plugin's validate should do best effort to validate, but should not fail. For compilation, the plugin is *not* called at all as if the validation failed
    * if `None` is a genuinely acceptable value, the plugin must encode it differently
      * _or_ we could add a ConfigurationOption field `allow_none` which the backend would obey -- but I would prefer not to do so, it seems a complication. None is a None.
    * if the plugin provides a `default`, the frontend is responsible to inject it
    * the frontend is expected to provide a warning to the user if a configuration value is missing

# Comments
Comment on `enumOpen`: the enumOpen is intended for situations like valid-invalid checkpoints -- we in principle allow users to provide a checkpoint that the backend does not consider valid.
The checkpoint type is actually enumOpen (compatible checkpoints) and enumClosed (all available checkpoints).
The plugin authors are expected to utilize enumOpen only, and an unavailable checkpoint will be verified by the backend itself.

Comment on `glyphs`: basically independent of this.
On the backend, glyphs are completely resolved _before_ the type validation and parsing is considered.
On the frontend, an expression with a glyph is not expected to be type validated or provide tab completion.
However, we would make a change to how we treat unresolvable expressions due to a missing glyph -- we will make it similar to "missing configuration option":
1. During validation, this option is not provided to the plugin as if the user did not fill it, and the plugin can still validate. And instead of reporting missing glyphs via errors, we report them via `resolved_configuration_options`.
2. During compilation, it is a hard fail.

The frontend can then treat missing glyph like a soft warning, which causes no big concern when saving a preset.
A malformed expression is _still_ an error with a hard stop like before -- this is similar to type conversion failure above.

Comment on `client_type_understanding`: we will create a test suite, something like a 3-column CSV, with first column being literal value, second column being input to python eval, third column input to javascript eval. Each implementation can then test itself.

Comment on `expand_left`: later in the feature pipeline, we have expanding to the left.
That can take multiple forms:
1/ For a product block with one or more inputs, start with it, then create a source block for each input slot.
2/ For an existing product block and source block, draw an arrow in between them.
3/ For an existing arrow between source and product, replace it with a transform between them.
Given the way how Qubed works, this should be reasonably easy to deliver -- we currently ask in expand "does the provided qubed intersect the qubed corresponding to this block?", which is symmetric.
This would most likely be done as a change from `expand(input)` to `expand(input?, output?)`.
This way, the plugin author knows which of the two potential qubeds (sources have only the output-qubed, whereas products and transforms have both input- and output- qubeds) to intersect with.
The BlockExpansion can be reused as output without a change.
Notably, this `expand` would not be required to provide _guaranteed_ results, that is of course NP-complete.
The qubed-based intersection, as an approximation, and any kind of heuristic particular to the plugin, is good enough.
