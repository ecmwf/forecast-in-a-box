import dataclasses
import logging
from datetime import datetime

import httpx
from forecastbox.config import fiab_home

logger = logging.getLogger(__name__)


@dataclasses.dataclass(frozen=True)
class Release:
    major: int
    minor: int
    patch: int

    @classmethod
    def from_string(cls, release_string: str) -> "Release":
        cleaned_string = release_string.lstrip("vd")
        parts = list(map(int, cleaned_string.split(".")))
        if len(parts) != 3:
            raise ValueError(f"Invalid release string format: {release_string}")
        return cls(major=parts[0], minor=parts[1], patch=parts[2])

    def __str__(self) -> str:
        return f"{self.major}.{self.minor}.{self.patch}"


async def get_most_recent_release() -> Release:
    async with httpx.AsyncClient() as client:
        response = await client.get("https://api.github.com/repos/ecmwf/forecast-in-a-box/releases?per_page=1")
        response.raise_for_status()
        releases = response.json()
        if not releases:
            raise ValueError("No releases found on GitHub.")
        if "tag_name" not in releases[0]:
            logger.error(f"mangled release: {releases[0]}")
            raise ValueError("Recent release is missing tag information")
        latest_release_tag = releases[0]["tag_name"]
        return Release.from_string(latest_release_tag)


def get_lock_timestamp() -> str:
    lock_file_path = fiab_home / "pylock.toml.timestamp"
    if not lock_file_path.is_file():
        return ""
    return lock_file_path.read_text().strip()


def get_local_release() -> tuple[datetime, Release]:
    """Reads the version & time from the pylock.toml.timestamp. If file not found / malformed,
    raises exception"""
    timestamp_str = get_lock_timestamp()
    if not timestamp_str:
        raise ValueError("No local pylock.toml.timestamp file found.")

    head, *lines = timestamp_str.splitlines()
    if lines:
        raise ValueError("Invalid format in pylock.toml.timestamp: expected exactly one line.")

    parts = head.split(":")
    if len(parts) != 2:
        raise ValueError("Invalid format in pylock.toml.timestamp: expected 'datetime:release_string'.")
    dt_str, release_str = parts

    try:
        dt_obj = datetime.fromtimestamp(int(dt_str))
    except Exception as e:
        raise ValueError(f"Failure to parse datetime. {dt_str[:32]}, {repr(e)}")
    release_obj = Release.from_string(release_str)
    return dt_obj, release_obj


async def get_pylock(release: Release) -> str:
    url = f"https://github.com/ecmwf/forecast-in-a-box/releases/download/v{release}/pylock.toml"
    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.text


def save_pylock(pylock: str, release: Release) -> None:
    pylock_file_path = fiab_home / "pylock.toml"
    timestamp_file_path = fiab_home / "pylock.toml.timestamp"

    fiab_home.mkdir(parents=True, exist_ok=True)

    pylock_file_path.write_text(pylock)
    timestamp_file_path.write_text(f"{int(datetime.now().timestamp())}:v{release}")
