# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import pytest
from pydantic import ValidationError

from fiab_core.fable import BlockConfigurationOption
from fiab_core.types import FableType, StringType


def test_block_configuration_option_caches_parsed_value_type() -> None:
    option = BlockConfigurationOption(title="Title", description="Description", value_type="str")

    assert isinstance(option.parsed_value_type, StringType)
    assert isinstance(option._value_type, FableType)


def test_block_configuration_option_excludes_cached_value_type_from_serialization() -> None:
    option = BlockConfigurationOption(title="Title", description="Description", value_type="str")

    dumped = option.model_dump()
    dumped_json = option.model_dump_json()

    assert "_value_type" not in dumped
    assert "_value_type" not in dumped_json
    assert dumped["value_type"] == "str"


def test_block_configuration_option_rejects_invalid_value_type() -> None:
    with pytest.raises(ValidationError, match="Invalid type expression"):
        BlockConfigurationOption(title="Title", description="Description", value_type="not-a-fable-type")
