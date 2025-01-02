"""
Interface to the MIR module
"""

import logging
import mir

logger = logging.getLogger(__name__)


def transform(
	input_grib: mir.GribMemoryInput,
	area: str,
) -> bytes:
	if not isinstance(input_grib, mir.GribMemoryInput):
		# NOTE this is because the grib mir job is not compatible with no-implicit-casting in cascade
		raise TypeError
	logger.error(f"starting mir transform with {area=}")
	logger.error("constructed input")
	buf = bytearray(64 * 1024 * 1024)  # TODO what is the optimal size? Should we calculate it? Cant the mir allocate dynamically?
	o = mir.GribMemoryOutput(buf)
	logger.error("constructed output")
	mir.Job(area=area).execute(input_grib, o)
	logger.error("executed job")
	return buf[: len(o)]
