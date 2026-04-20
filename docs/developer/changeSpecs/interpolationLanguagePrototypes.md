We want to develop a better system for interpolation as a means of customizing workflow inputs.
See backend/src/forecastbox/domain/glyphs/resolution.py, the function `_substitute_glyphs` for what is currently supported:
We basically allow to replace strings like "${var1} literal ${var2}" with actual values of var1 and var2.

But we want something better:
 - application of functions for datetime manipulation:
   - adding/subtracting time deltas, eg `${submitDatetime + timedelta(days=1)}`
   - rounding, eg `${submitDatetime.down_to_midnight()}`
 - application of functions for strings:
   - eg `"${myParam1.uppercase()}"` or `"${myParam1.split('_', 1)[0]}"`
 - arithmetics: `"${42**10}"`, `"${1e10}"`, ...

You will develop multiple prototypes for this.
Do not feel constrained by the syntax examples, its about meeting the need of the data transformation, not hitting the exact syntax.
It is a bonus if the syntax feels pythonic, but it is not required -- prefer simplicity and brevity over pythonicity.
Of course it must be unambiguous and sound.

We require two functions:
 - `resolve_expression(raw: str, variables: dict[str, str]) -> str`
 - `extract_glyphs(raw: str) -> set[str]`

Primarily, they need to be implemented in python. It would be a plus side if they have a JavaScript interface, but it is not a must have -- ultimately, we probably want to write them in rust in the first place, and provide to python via maturin and to javascript via webassembly. But if the JavaScript serving option was simpler (eg because the prototype utilizes a library which exists for javascript already), its a plus. This would obviously be valid only if the python code on top of the library was minimal.
Either way, for the prototype, consider pure pythonic implementation, only mention the portability aspects in evaluation, dont implement them.

You should explore multiple solutions, based on for example:
 - Jinja2
 - Google CEL
 - Simpleeveal
 - Custom grammar in EBNF + eg Lark-based parser
 - Anything else you ideate.

Create a new directory, `languagePrototypes`, at the repository's root.
For each prototype, create a subfolder there.
In the subfolder would be:
 - a python file which exposes the two functions above,
 - a readme file which describes the syntax, showcased on examples like the ones mentioned in this document,
 - requirements.txt (like `jinja2`).
Dont create any pyproject.toml or tests or anything, this is just a prototype.

Feel free to delegate work on prototypes to subagents -- just make sure that they utilize roughly the same set of examples (even though their syntaxes can differ).

