"""
Responsible for installing python modules required by a Task/Job in an isolated manner,
and cleaning up afterwards.
"""

from forecastbox.api.common import TaskEnvironment
import tempfile
import subprocess
from typing import Optional
import sys
import os
import logging

logger = logging.getLogger(__name__)


def prepare(job_id: str, environment: TaskEnvironment) -> Optional[tempfile.TemporaryDirectory]:
	"""Installs given packages into a temporary directory, just for this job -- a lightweight venv.
	Assumes `uv` binary is available, and that we are already in a usable venv of the right python
	version -- as provided by `fiab.sh`"""
	if environment.packages:
		td = tempfile.TemporaryDirectory()
		install_command = ["uv", "pip", "install", "--target", td.name]
		if os.environ.get("FIAB_OFFLINE", "") == "YES":
			install_command += ["--offline"]
		if cache_dir := os.environ.get("FIAB_CACHE", ""):
			install_command += ["--cache-dir", cache_dir]
		# NOTE sadly python doesn't offer `tempfile.get_temporary_directory_location` or similar
		# We thus need to return the tempfile object for a later cleanup, instead of being able to
		# derive it from `job_id` only
		install_command.extend(set(environment.packages))
		subprocess.run(install_command, check=True)
		sys.path.append(td.name)
		return td
	else:
		return None
