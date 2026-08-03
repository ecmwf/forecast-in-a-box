# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Unit tests for domain/lens/metadata_db persistence layer."""

from collections.abc import Generator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import forecastbox.domain.lens.metadata_db as metadata_db
from forecastbox.schemata.jobs import Base
from forecastbox.utility.auth import AuthContext

_user1 = AuthContext(user_id="user1", is_admin=False)
_user2 = AuthContext(user_id="user2", is_admin=False)
_admin = AuthContext(user_id="admin", is_admin=True)


@pytest.fixture
def mem_session_maker(monkeypatch: pytest.MonkeyPatch) -> Generator[sessionmaker[Session], None, None]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    maker = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(metadata_db._jobs_module, "sync_session_maker", maker)
    yield maker
    engine.dispose()


# ---------------------------------------------------------------------------
# upsert_lens_metadata
# ---------------------------------------------------------------------------


def test_upsert_creates_new_row(mem_session_maker: sessionmaker[Session]) -> None:
    row = metadata_db.upsert_lens_metadata("skinnyWMS", "myId", {"foo": "bar"}, False, _user1)
    assert row.lens_id == "skinnyWMS"
    assert row.lens_metadata_id == "myId"
    assert row.metadata_content == {"foo": "bar"}
    assert row.public is False
    assert row.created_by == "user1"


def test_upsert_owner_can_update(mem_session_maker: sessionmaker[Session]) -> None:
    row1 = metadata_db.upsert_lens_metadata("skinnyWMS", "myId", {"v": 1}, False, _user1)
    row2 = metadata_db.upsert_lens_metadata("skinnyWMS", "myId", {"v": 2}, True, _user1)
    assert row2.metadata_content == {"v": 2}
    assert row2.public is True
    assert row2.created_by == "user1"
    assert row1.created_at == row2.created_at


def test_upsert_different_users_same_id_creates_separate_rows(mem_session_maker: sessionmaker[Session]) -> None:
    """Two different users can each have a row with the same (lens_id, lens_metadata_id)."""
    row1 = metadata_db.upsert_lens_metadata("skinnyWMS", "myId", {"owner": "user1"}, False, _user1)
    row2 = metadata_db.upsert_lens_metadata("skinnyWMS", "myId", {"owner": "user2"}, False, _user2)
    assert row1.created_by == "user1"
    assert row2.created_by == "user2"
    assert row1.metadata_content == {"owner": "user1"}
    assert row2.metadata_content == {"owner": "user2"}


def test_upsert_different_lens_ids_independent(mem_session_maker: sessionmaker[Session]) -> None:
    metadata_db.upsert_lens_metadata("skinnyWMS", "myId", {"a": 1}, False, _user1)
    row = metadata_db.upsert_lens_metadata("otherLens", "myId", {"a": 2}, False, _user1)
    rows = list(metadata_db.list_lens_metadata("otherLens", _user1))
    assert len(rows) == 1
    assert rows[0].lens_id == "otherLens"
    assert row.metadata_content == {"a": 2}


# ---------------------------------------------------------------------------
# list_lens_metadata / count_lens_metadata -- visibility
# ---------------------------------------------------------------------------


def test_non_admin_sees_own_and_public_rows(mem_session_maker: sessionmaker[Session]) -> None:
    metadata_db.upsert_lens_metadata("skinnyWMS", "own", {}, False, _user1)
    metadata_db.upsert_lens_metadata("skinnyWMS", "pub", {}, True, _user2)
    metadata_db.upsert_lens_metadata("skinnyWMS", "private-other", {}, False, _user2)

    rows = list(metadata_db.list_lens_metadata("skinnyWMS", _user1))
    ids = {r.lens_metadata_id for r in rows}
    assert ids == {"own", "pub"}
    assert metadata_db.count_lens_metadata("skinnyWMS", _user1) == 2


def test_admin_sees_all_rows(mem_session_maker: sessionmaker[Session]) -> None:
    metadata_db.upsert_lens_metadata("skinnyWMS", "own", {}, False, _user1)
    metadata_db.upsert_lens_metadata("skinnyWMS", "pub", {}, True, _user2)
    metadata_db.upsert_lens_metadata("skinnyWMS", "private-other", {}, False, _user2)

    rows = list(metadata_db.list_lens_metadata("skinnyWMS", _admin))
    ids = {r.lens_metadata_id for r in rows}
    assert ids == {"own", "pub", "private-other"}
    assert metadata_db.count_lens_metadata("skinnyWMS", _admin) == 3


def test_list_filters_by_lens_metadata_id(mem_session_maker: sessionmaker[Session]) -> None:
    metadata_db.upsert_lens_metadata("skinnyWMS", "a", {}, False, _user1)
    metadata_db.upsert_lens_metadata("skinnyWMS", "b", {}, False, _user1)

    rows = list(metadata_db.list_lens_metadata("skinnyWMS", _user1, lens_metadata_id="a"))
    assert [r.lens_metadata_id for r in rows] == ["a"]
    assert metadata_db.count_lens_metadata("skinnyWMS", _user1, lens_metadata_id="a") == 1


def test_list_can_return_own_and_public_rows_for_same_id(mem_session_maker: sessionmaker[Session]) -> None:
    """A caller's own row and another user's public row may share the same id;
    both are returned -- merging is left to the frontend."""
    metadata_db.upsert_lens_metadata("skinnyWMS", "shared", {"who": "user1"}, False, _user1)
    metadata_db.upsert_lens_metadata("skinnyWMS", "shared", {"who": "admin-default"}, True, _admin)

    rows = list(metadata_db.list_lens_metadata("skinnyWMS", _user1, lens_metadata_id="shared"))
    owners = {r.created_by for r in rows}
    assert owners == {"user1", "admin"}


def test_list_pagination(mem_session_maker: sessionmaker[Session]) -> None:
    for i in range(5):
        metadata_db.upsert_lens_metadata("skinnyWMS", f"id{i}", {}, False, _user1)
    rows = list(metadata_db.list_lens_metadata("skinnyWMS", _user1, offset=2, limit=2))
    assert len(rows) == 2


# ---------------------------------------------------------------------------
# delete_lens_metadata
# ---------------------------------------------------------------------------


def test_delete_own_row_succeeds(mem_session_maker: sessionmaker[Session]) -> None:
    metadata_db.upsert_lens_metadata("skinnyWMS", "myId", {}, False, _user1)
    deleted = metadata_db.delete_lens_metadata("skinnyWMS", "myId", _user1)
    assert deleted is not None
    assert deleted.created_by == "user1"
    assert list(metadata_db.list_lens_metadata("skinnyWMS", _user1)) == []


def test_delete_missing_row_returns_none(mem_session_maker: sessionmaker[Session]) -> None:
    assert metadata_db.delete_lens_metadata("skinnyWMS", "doesNotExist", _user1) is None


def test_delete_never_targets_other_users_row(mem_session_maker: sessionmaker[Session]) -> None:
    """Delete is always scoped to the caller's own row -- even for a public row owned by
    someone else, and even for admins."""
    metadata_db.upsert_lens_metadata("skinnyWMS", "myId", {}, True, _user1)

    assert metadata_db.delete_lens_metadata("skinnyWMS", "myId", _user2) is None
    assert metadata_db.delete_lens_metadata("skinnyWMS", "myId", _admin) is None
    # row is still there, owned by user1
    rows = list(metadata_db.list_lens_metadata("skinnyWMS", _user1, lens_metadata_id="myId"))
    assert len(rows) == 1
    assert rows[0].created_by == "user1"
