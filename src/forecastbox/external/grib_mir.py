"""
Interface to the MIR module
"""

import logging
import mir

logger = logging.getLogger(__name__)


def transform(
	input_grib: memoryview,
	input_grib_len: int,
	area: str,
) -> bytes:
	logger.error(f"starting mir transform with {area=}")
	i = mir.GribMemoryInput(input_grib[:input_grib_len])
	logger.error("constructed input")
	buf = bytearray(64 * 1024 * 1024)  # TODO what is the optimal size? Should we calculate it? Cant the mir allocate dynamically?
	o = mir.GribMemoryOutput(buf)
	logger.error("constructed output")
	mir.Job(area=area).execute(i, o)
	logger.error("executed job")
	return buf[: len(o)]
