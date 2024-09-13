"""
Responsible for installing python modules required by a Task/Job in an isolated manner,
and cleaning up afterwards.
"""

# NOTE sadly python doesn't offer `tempfile.get_temporary_directory_location` or similar
# We thus need to return the tempfile object for a later cleanup, instead of being able to
# derive it from `job_id` only
# TODO the whole `set_up_python` thing should probably displace the whole pyinstaller business,
# and we should ship just bash script that installs uv, uv then bootstraps python + venv,
# that python + venv then install the main package, and last step of the bash is we launch
# `uv_python -m standalone.entrypoint`. The prepare here would remain, but would actually create
# a regular venv and pip install in there

from forecastbox.api.common import TaskEnvironment
import tempfile
import subprocess
from typing import Optional
import sys
import os
import logging

logger = logging.getLogger(__name__)


def set_up_python():
	if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
		uv_command = f"{sys._MEIPASS}/uv/uv"
		subprocess.run([uv_command, "python", "install", "3.11"], check=True)


def prepare(job_id: str, environment: TaskEnvironment) -> Optional[tempfile.TemporaryDirectory]:
	uv_python: list[str]
	if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
		uv_command = f"{sys._MEIPASS}/uv/uv"
		uv_query = subprocess.run([uv_command, "python", "list"], check=True, capture_output=True)
		interpreter_info = [e for e in uv_query.stdout.decode().split("\n") if "python3.11" in e][0]
		interpreter_exec = interpreter_info[interpreter_info.index(" ") :].split("->", 1)[0].strip()
		logger.info(f"obtained interpreter {interpreter_exec}")
		interpreter_path = f"{os.getcwd()}/{interpreter_exec}"
		logger.info(f"interpreter fullpath {interpreter_path}")
		uv_python = ["--python", interpreter_path]
	else:
		uv_command = "uv"
		uv_python = []

	if environment.packages:
		td = tempfile.TemporaryDirectory()
		install_command = [uv_command, "pip", "install", "--target", td.name] + uv_python
		install_command.extend(set(environment.packages))
		subprocess.run(install_command, check=True)
		sys.path.append(td.name)
		return td
	else:
		return None
