"""
Responsible for installing python modules required by a Task/Job in an isolated manner,
and cleaning up afterwards.
"""

# NOTE sadly python doesn't offer `tempfile.get_temporary_directory_location` or similar
# We thus need to return the tempfile object for a later cleanup, instead of being able to
# derive it from `job_id` only

from forecastbox.api.common import TaskEnvironment
import tempfile
import subprocess
from typing import Optional
import sys


def prepare(job_id: str, environment: TaskEnvironment) -> Optional[tempfile.TemporaryDirectory]:
	if environment.packages:
		td = tempfile.TemporaryDirectory()
		uv_command = ["uv", "pip", "install", "--target", td.name]
		uv_command.extend(set(environment.packages))
		subprocess.run(uv_command, check=True)
		sys.path.append(td.name)
		return td
	else:
		return None
