# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from unittest.mock import Mock

import pytest

from fiab_plugin_ecmwf.runtime.plots import FORMAT_MIME_TYPES, _export_figure


@pytest.mark.parametrize(
    ("fmt", "expected_mime"),
    [("png", "image/png"), ("pdf", "application/pdf"), ("svg", "image/svg+xml")],
)
def test_export_figure_returns_standard_mime(fmt: str, expected_mime: str) -> None:
    """_export_figure tags bytes with the same standard MIME MapPlotSink declares."""
    _, mime = _export_figure(Mock(), fmt=fmt)  # type: ignore[arg-type]
    assert mime == expected_mime
    assert FORMAT_MIME_TYPES[fmt] == expected_mime
