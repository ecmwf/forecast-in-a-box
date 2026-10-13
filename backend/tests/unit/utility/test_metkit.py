# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import threading

import pytest
from pymetkit.paramdb import ParamDB

import forecastbox.utility.metkit as metkit


def test_get_paramdb_reuses_database_per_thread(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(metkit, "_paramdb_context", threading.local())
    main_db = metkit.get_paramdb()
    assert metkit.get_paramdb() is main_db

    thread_databases: list[ParamDB] = []

    def collect_database() -> None:
        thread_databases.append(metkit.get_paramdb())
        assert metkit.get_paramdb() is thread_databases[-1]

    threads = [threading.Thread(target=collect_database) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(thread_databases) == 2
    assert len({id(main_db), *(id(paramdb) for paramdb in thread_databases)}) == 3
