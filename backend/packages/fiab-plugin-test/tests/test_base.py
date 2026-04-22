# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import struct

from fiab_plugin_test import *  # noqa: F403
from fiab_plugin_test.runtime import sink_image


def test_ok() -> None:
    """Tests, as a minimum, that everything can be imported"""
    assert True


def test_sink_image_returns_valid_png() -> None:
    result = sink_image(42)

    assert isinstance(result, bytes)
    assert len(result) > 0
    assert result[:8] == b"\x89PNG\r\n\x1a\n", "Missing PNG signature"

    # IHDR chunk starts at offset 8
    # layout: 4B length | 4B type | 13B data | 4B CRC
    assert result[8:12] == b"\x00\x00\x00\x0d", "IHDR length must be 13"
    assert result[12:16] == b"IHDR"
    width = struct.unpack(">I", result[16:20])[0]
    height = struct.unpack(">I", result[20:24])[0]
    bit_depth = result[24]
    color_type = result[25]

    assert width == 64
    assert height == 64
    assert bit_depth == 8
    assert color_type == 0  # grayscale

    assert b"IEND" in result, "PNG must contain IEND chunk"


def test_sink_image_modulo_256() -> None:
    """Values >= 256 are taken modulo 256."""
    result_low = sink_image(42)
    result_high = sink_image(42 + 256)
    assert result_low == result_high
