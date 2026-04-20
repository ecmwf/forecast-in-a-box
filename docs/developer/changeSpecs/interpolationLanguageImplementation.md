Inspect the folder languagePrototypes/jinja2_proto -- start with readme, then implementation.

Then inspect the backend in this repository, most importantly the submodule `domain.glyphs`.
Currently, the glyphs domain is about turning strings like `"${myVar1} ${myVar2}"` together
with a dictionary like `{"myVar1": "${myVar3}", "myVar2": "bar", "myVar3": "foo"}`, into
the interpolated resul, in this case "foo bar".

Your role is to replace the current regex-substitution-only system with the jinja2 based system,
including the new extra functions and rules. The new language extends the original one,
meaning all the existing tests should pass without a change.

Additionally add new unit tests that verify the new language features are in place -- take
inspiration in the readme of the languagePrototypes/jinja2_proto, as well the function
`_make_jinja2` in the file `languagePrototypes/_benchmark/main.py` (ignore the other
language prototypes).

After `just val` passes, commit your changes, but dont push. Ideally make it so that
the first commit handles the new code in backend/src, second commit the new tests in
backend/tests.

Dont modify either docs/ or languagePrototypes.
