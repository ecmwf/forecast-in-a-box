# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for the synchronous run background worker."""

import datetime as dt
import inspect
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from forecastbox.domain.glyphs.global_db import GlyphResolutionBuckets
from forecastbox.domain.run.background import execute_background
from forecastbox.domain.run.db import CompilerRuntimeContext
from forecastbox.domain.run.types import RunId
from forecastbox.utility.auth import AuthContext


def _make_blueprint() -> SimpleNamespace:
    return SimpleNamespace(
        builder={"blocks": [], "environment": None, "local_glyphs": {}},
        blueprint_id="bp-1",
    )


def test_execute_background_has_no_loop_argument_and_uses_jobs_db_updates() -> None:
    signature = inspect.signature(execute_background)
    assert "loop" not in signature.parameters

    jobs_calls: list[str] = []

    def fake_jobs_db_result(task_name: str, task: object) -> object:
        jobs_calls.append(task_name)
        if task_name == "run.background.get-glyphs":
            return GlyphResolutionBuckets(public_overriddable={}, user_own={}, public_nonoverridable={})
        return None

    with (
        patch("forecastbox.domain.run.background._jobs_db_result", side_effect=fake_jobs_db_result),
        patch("forecastbox.domain.run.background.resolve_intrinsic_glyph_values", return_value={}),
        patch(
            "forecastbox.domain.run.background.compile_builder", return_value=(MagicMock(), MagicMock(model_dump=lambda: {}), MagicMock())
        ),
        patch("forecastbox.domain.run.background.execute_cascade", return_value=SimpleNamespace(job_id=None, error="cascade failed")),
    ):
        execute_background(
            RunId("run-1"),
            1,
            dt.datetime(2026, 5, 12),
            _make_blueprint(),
            CompilerRuntimeContext(),
            AuthContext(user_id="user-1", is_admin=False),
        )

    assert jobs_calls == [
        "run.background.get-glyphs",
        "run.background.update-runtime",
        "run.background.update-runtime",
    ]
