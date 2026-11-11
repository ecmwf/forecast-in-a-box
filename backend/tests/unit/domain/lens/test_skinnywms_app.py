# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import os
import subprocess
import sys
from pathlib import Path

import pytest


def test_import_indexes_the_data_folder() -> None:
    skinnywms = pytest.importorskip("skinnywms")
    data = Path(skinnywms.__file__).parent / "testdata"
    # A fresh interpreter: the import reads SKINNYWMS_DATA_PATH once
    code = "from forecastbox.domain.lens import skinnywms_app as app; print(app.server.availability._loaded)"
    result = subprocess.run(
        [sys.executable, "-c", code],
        env={**os.environ, "SKINNYWMS_DATA_PATH": str(data)},
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip().splitlines()[-1] == "True"
