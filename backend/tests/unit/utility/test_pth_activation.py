# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import sys
from pathlib import Path

import pytest

from forecastbox.utility.pth_activation import (
    activate_editable_installs,
    activate_new_pth_files,
    is_running_interpreter,
    own_site_packages_dir,
    snapshot_pth_filenames,
)


def test_is_running_interpreter_true_for_sys_executable() -> None:
    assert is_running_interpreter(sys.executable)


def test_is_running_interpreter_false_for_other_path(tmp_path: Path) -> None:
    other = tmp_path / "not-a-real-python"
    other.write_text("")
    assert not is_running_interpreter(str(other))


def test_own_site_packages_dir_matches_sysconfig() -> None:
    import sysconfig

    assert own_site_packages_dir() == sysconfig.get_paths()["purelib"]


def test_snapshot_pth_filenames_lists_only_pth_and_ignores_hidden(tmp_path: Path) -> None:
    (tmp_path / "a.pth").write_text("/some/path\n")
    (tmp_path / "b.pth").write_text("/some/other/path\n")
    (tmp_path / ".hidden.pth").write_text("/ignored\n")
    (tmp_path / "not-a-pth.txt").write_text("irrelevant\n")

    assert snapshot_pth_filenames(str(tmp_path)) == {"a.pth", "b.pth"}


def test_snapshot_pth_filenames_missing_dir_returns_empty_set(tmp_path: Path) -> None:
    assert snapshot_pth_filenames(str(tmp_path / "does-not-exist")) == set()


def test_activate_new_pth_files_extends_sys_path_for_plain_path_entries(tmp_path: Path) -> None:
    new_dir = tmp_path / "src-like"
    new_dir.mkdir()
    (tmp_path / "editable.pth").write_text(f"{new_dir}\n")

    before: set[str] = set()
    after = snapshot_pth_filenames(str(tmp_path))
    try:
        activated = activate_new_pth_files(str(tmp_path), before, after)
        assert activated == ["editable.pth"]
        assert str(new_dir) in sys.path
    finally:
        if str(new_dir) in sys.path:
            sys.path.remove(str(new_dir))


def test_activate_new_pth_files_executes_import_lines_for_finder_based_editables(tmp_path: Path) -> None:
    """PEP 660 finder-based editable installs write a ``.pth`` file whose content is a single
    ``import ...`` line (registering a meta-path finder). Emulate that shape with a line that
    just sets a recognisable marker, since we only care that it gets ``exec``'d."""
    marker_attr = "_pth_activation_test_marker"
    (tmp_path / "finder-based.pth").write_text(f"import sys; sys.{marker_attr} = True\n")

    before: set[str] = set()
    after = snapshot_pth_filenames(str(tmp_path))
    try:
        activated = activate_new_pth_files(str(tmp_path), before, after)
        assert activated == ["finder-based.pth"]
        assert getattr(sys, marker_attr, False) is True
    finally:
        if hasattr(sys, marker_attr):
            delattr(sys, marker_attr)


def test_activate_new_pth_files_does_not_reprocess_already_known_files(tmp_path: Path) -> None:
    new_dir = tmp_path / "src-like"
    new_dir.mkdir()
    (tmp_path / "editable.pth").write_text(f"{new_dir}\n")

    after = snapshot_pth_filenames(str(tmp_path))
    try:
        first = activate_new_pth_files(str(tmp_path), set(), after)
        assert first == ["editable.pth"]

        # Same before/after (nothing new since the first call) -> no-op.
        second = activate_new_pth_files(str(tmp_path), after, after)
        assert second == []
    finally:
        if str(new_dir) in sys.path:
            sys.path.remove(str(new_dir))


def test_activate_new_pth_files_warns_and_continues_on_a_broken_pth_file(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    (tmp_path / "broken.pth").write_text("import this_module_does_not_exist_anywhere\n")

    activated = activate_new_pth_files(str(tmp_path), set(), snapshot_pth_filenames(str(tmp_path)))
    # site.addpackage itself swallows per-line exec errors (prints to stderr, keeps going), so the
    # file is still reported as "activated" -- we assert this call does not raise.
    assert activated == ["broken.pth"]


def test_activate_editable_installs_noop_for_a_different_interpreter(tmp_path: Path) -> None:
    new_dir = tmp_path / "src-like"
    new_dir.mkdir()
    (tmp_path / "editable.pth").write_text(f"{new_dir}\n")

    other_python = tmp_path / "not-the-running-python"
    other_python.write_text("")

    activated = activate_editable_installs(str(other_python), str(tmp_path), before=set())
    assert activated == []
    assert str(new_dir) not in sys.path


def test_activate_editable_installs_activates_for_the_running_interpreter(tmp_path: Path) -> None:
    new_dir = tmp_path / "src-like"
    new_dir.mkdir()

    before = snapshot_pth_filenames(str(tmp_path))
    (tmp_path / "editable.pth").write_text(f"{new_dir}\n")

    try:
        activated = activate_editable_installs(sys.executable, str(tmp_path), before)
        assert activated == ["editable.pth"]
        assert str(new_dir) in sys.path
    finally:
        if str(new_dir) in sys.path:
            sys.path.remove(str(new_dir))


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
