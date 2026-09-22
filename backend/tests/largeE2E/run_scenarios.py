#!/usr/bin/env python3
# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Runner for the largeE2E scenarios.

Discovers every `case_*.py` module in this directory and calls its `run(client)` entrypoint in
turn, each against its own fresh `httpx.Client` (see common.make_client). Exits non-zero if any
scenario raises.

Meant to be launched standalone, without the backend's own virtualenv or a `forecastbox` install::

    uvx --with httpx python run_scenarios.py

(or via `just run` in this directory, which does exactly that). Point it at a non-default backend
with the FIAB_E2E_BASE_URL environment variable (see common.base_url).
"""

from __future__ import annotations

import importlib
import logging
import sys
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from common import configure_logging, make_client  # noqa: E402

logger = logging.getLogger("forecastbox.tests.runner")


def discover_cases() -> list[str]:
    return sorted(p.stem for p in HERE.glob("case_*.py"))


def main() -> int:
    configure_logging()
    cases = discover_cases()
    if not cases:
        logger.warning("no case_* scenarios found, nothing to run")
        return 0

    logger.info(f"discovered scenarios: {cases}")
    failures: list[str] = []
    for case_name in cases:
        logger.info(f"--- running {case_name} ---")
        try:
            module = importlib.import_module(case_name)
            with make_client() as client:
                module.run(client)
            logger.info(f"--- {case_name} PASSED ---")
        except Exception:
            logger.error(f"--- {case_name} FAILED ---")
            traceback.print_exc()
            failures.append(case_name)

    if failures:
        logger.error(f"{len(failures)}/{len(cases)} scenario(s) failed: {failures}")
        return 1
    logger.info(f"all {len(cases)} scenario(s) passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
