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

from collections.abc import Sequence
from pathlib import Path

from fiab_core.artifacts import ArtifactStoreId, parse_json


def main(argv: Sequence[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    args = parser.parse_args(argv)

    data = args.path.read_text()
    dict(parse_json(ArtifactStoreId("validation"), data, lambda _checkpoint: (True, None)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
