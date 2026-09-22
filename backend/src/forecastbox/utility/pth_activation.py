# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Runtime activation of freshly created ``.pth`` files, so that an editable (``pip install -e``)
plugin install becomes importable in the *current* process without a restart.

Background
----------
A regular (non-editable) install drops a distribution's files directly under an existing
``sys.path`` entry (``site-packages``), so it becomes importable as soon as the import system
notices the new files -- which it normally does on its own (``FileFinder`` re-stats directories).

An editable install is different: nothing is placed under an existing ``sys.path`` entry. Instead,
pip/uv write a new ``*.pth`` file into ``site-packages`` -- either a plain source path (classic
setuptools "compat"/pth mode, any layout) or an ``import ...`` line that registers a PEP 660
meta-path finder (setuptools "finder" mode, hatchling, pdm, flit, ...). ``.pth`` files are only
read by the ``site`` module once, at interpreter start-up (``site.addsitedir``); a long-running
process never re-scans ``site-packages`` for new ones, so the editable install stays unimportable
until the process restarts.

This module replays exactly what ``site.addsitedir``/``site.addpackage`` would do at start-up, but
scoped to only the ``.pth`` files a specific install just created -- so it works regardless of the
editable-install layout/backend, without guessing (contrast with assuming a PEP 517 ``src/`` layout
and manually extending ``sys.path``).

Safety: this only makes sense, and is only safe, to do *in-process* for the interpreter that is
actually running this code -- mutating ``sys.path``/``sys.meta_path`` of some other, unrelated
interpreter would be meaningless. Since the plugin installer always targets ``sys.executable``,
``is_running_interpreter`` compares against the executable path captured once at import time
(before any caller could reassign ``sys.executable``, which is done in some test harnesses to
target a separate scratch interpreter while the actual running process stays the original one).
"""

import importlib
import logging
import os
import site
import sys
import sysconfig

logger = logging.getLogger(__name__)

# Captured once at import time, so that later reassignment of ``sys.executable`` (done by some
# test harnesses to point the plugin installer at a separate, disposable interpreter while this
# process itself keeps running under the original one) cannot fool `is_running_interpreter`.
_RUNNING_EXECUTABLE = os.path.realpath(sys.executable)


def is_running_interpreter(python: str) -> bool:
    """Return whether *python* is the interpreter actually executing this code, rather than merely
    equal to a (possibly reassigned) ``sys.executable``."""
    try:
        return os.path.realpath(python) == _RUNNING_EXECUTABLE
    except OSError:
        return False


def own_site_packages_dir() -> str:
    """Return this running interpreter's ``site-packages`` (``purelib``) directory."""
    return sysconfig.get_paths()["purelib"]


def snapshot_pth_filenames(site_dir: str) -> set[str]:
    """Return the set of ``*.pth`` filenames currently present in *site_dir*. Best-effort: an
    unreadable/missing directory yields an empty set rather than raising."""
    try:
        return {name for name in os.listdir(site_dir) if name.endswith(".pth") and not name.startswith(".")}
    except OSError as e:
        logger.debug(f"failed to list {site_dir!r} for .pth activation: {repr(e)}")
        return set()


def activate_new_pth_files(site_dir: str, before: set[str], after: set[str]) -> list[str]:
    """Process every ``.pth`` filename present in *after* but not in *before* the same way
    ``site.addsitedir`` would at interpreter start-up (extending ``sys.path`` for plain source-path
    entries, or executing the ``import ...`` line for PEP 660 finder-based editable installs).

    Only genuinely new filenames are processed, so ``.pth`` files already activated by an earlier
    call (e.g. from a previous plugin install in this same process) are never replayed -- this
    avoids double-registering PEP 660 meta-path finders on every unrelated subsequent install.

    Returns the sorted list of filenames that were activated, for logging; does not itself call
    ``importlib.invalidate_caches()`` -- callers should do so if the returned list is non-empty.
    """
    new_names = sorted(after - before)
    for name in new_names:
        try:
            site.addpackage(site_dir, name, known_paths=None)
        except Exception as e:  # noqa: BLE001 -- best-effort activation, a failure here should not fail the install
            logger.warning(f"failed to activate .pth file {name!r} in {site_dir!r}: {repr(e)}")
    return new_names


def activate_editable_installs(python: str, site_dir: str, before: set[str]) -> list[str]:
    """Convenience wrapper: re-snapshot *site_dir*, activate any ``.pth`` files created since
    *before* was taken, and invalidate import caches if anything was activated. No-op (and returns
    an empty list) if *python* is not the interpreter actually running this code."""
    if not is_running_interpreter(python):
        return []
    after = snapshot_pth_filenames(site_dir)
    activated = activate_new_pth_files(site_dir, before, after)
    if activated:
        importlib.invalidate_caches()
    return activated
