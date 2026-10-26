#!/usr/bin/env python3
#
# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Runs the Fable types conformance suite from ``tests/conformance``.

Each line of ``valid_types.jsonl`` is a json object with keys ``term`` (a canonical type expression),
``ast`` (the expected output of AstDumpTransformer), ``value_valid`` and ``value_invalid`` (values
which the parsed type's validate_convert must accept and reject, respectively). For each line, the
term must parse, dump to the expected ast, accept/reject the values, and serialize back to the term.

Each line of ``invalid_types.jsonl`` is a json object with a single key ``term``, which must fail
to parse.

The same files are meant to be consumed by other implementations of the type parser, eg the frontend.
"""

import json
import logging
import sys
from collections.abc import Iterator, Sequence
from pathlib import Path
from typing import Any

from fiab_core.types.parser import dump_ast, parse

DEFAULT_DIR = Path(__file__).parent.parent / "tests" / "conformance"


def _read_jsonl(pth: Path) -> Iterator[tuple[int, dict[str, Any]]]:
    with pth.open() as f:
        for lineno, line in enumerate(f, start=1):
            if line.strip():
                yield (lineno, json.loads(line))


def _accepts(term: str, value: Any) -> bool:
    try:
        parse(term).validate_convert(value)
        return True
    except Exception:
        return False


def check_valid(lineno: int, case: dict[str, Any]) -> list[str]:
    """Run all checks of a single valid_types.jsonl case, returning a list of failure descriptions."""
    term = case["term"]
    prefix = f"valid_types.jsonl:{lineno} {term!r}:"
    try:
        parsed = parse(term)
    except Exception as e:
        return [f"{prefix} failed to parse: {e!r}"]
    errors: list[str] = []
    try:
        ast = dump_ast(term)
        if ast != case["ast"]:
            errors.append(f"{prefix} ast mismatch, expected {case['ast']}, got {ast}")
    except Exception as e:
        errors.append(f"{prefix} failed to dump ast: {e!r}")
    if not _accepts(term, case["value_valid"]):
        errors.append(f"{prefix} rejected value_valid {case['value_valid']!r}")
    if _accepts(term, case["value_invalid"]):
        errors.append(f"{prefix} accepted value_invalid {case['value_invalid']!r}")
    serialized = parsed.serialize()
    if serialized != term:
        errors.append(f"{prefix} serialized to {serialized!r}")
    return errors


def check_invalid(lineno: int, case: dict[str, Any]) -> list[str]:
    """Check that a single invalid_types.jsonl case fails to parse, returning a list of failure descriptions."""
    term = case["term"]
    try:
        parse(term)
    except Exception:
        return []
    return [f"invalid_types.jsonl:{lineno} {term!r}: parsed successfully"]


def main(argv: Sequence[str] | None = None) -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path, nargs="?", default=DEFAULT_DIR)
    args = parser.parse_args(argv)
    # NOTE silences eg the warnings about missing artifacts provider, irrelevant for the binary checks here
    logging.disable(logging.WARNING)

    errors: list[str] = []
    valid = list(_read_jsonl(args.directory / "valid_types.jsonl"))
    for lineno, case in valid:
        errors.extend(check_valid(lineno, case))
    invalid = list(_read_jsonl(args.directory / "invalid_types.jsonl"))
    for lineno, case in invalid:
        errors.extend(check_invalid(lineno, case))

    if errors:
        print("\n".join(errors), file=sys.stderr)
        sys.exit(1)
    print(f"types conformance: {len(valid)} valid and {len(invalid)} invalid cases passed")


if __name__ == "__main__":
    main()
