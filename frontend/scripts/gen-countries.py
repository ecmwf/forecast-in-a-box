#!/usr/bin/env python3
# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.

"""Generate the static country list for the geodomain picker.

Run once (this is NOT part of the build) with a Python that has cartopy installed, e.g. the
backend venv::

    backend/.venv/bin/python frontend/scripts/gen-countries.py

Names come from Natural Earth 110m ``admin_0_countries`` ``NAME_LONG`` -- the exact dataset,
resolution and attribute earthkit-plots' ``NaturalEarthDomain`` matches against (case
insensitively) -- so every shipped name resolves to a bounding box server-side. The output is
grouped/sorted by continent then name and committed; only re-run it to refresh the list.
"""

import json
from collections import Counter
from pathlib import Path

import cartopy.io.shapereader as shpreader

OUT = Path(__file__).resolve().parents[1] / "src/components/base/fields/data/countries.json"
# Polar / uninhabited groupings that would each form a one-item continent group.
DROP_CONTINENTS = {"Antarctica", "Seven seas (open ocean)"}


def main() -> None:
    shapefile = shpreader.natural_earth(resolution="110m", category="cultural", name="admin_0_countries")
    seen: set[str] = set()
    rows: list[dict[str, str]] = []
    for record in shpreader.Reader(shapefile).records():
        name = (record.attributes.get("NAME_LONG") or "").replace("\x00", "").strip()
        continent = (record.attributes.get("CONTINENT") or "").replace("\x00", "").strip()
        if not name or continent in DROP_CONTINENTS or name in seen:
            continue
        seen.add(name)
        rows.append({"name_long": name, "continent": continent or "Other"})

    rows.sort(key=lambda row: (row["continent"], row["name_long"]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    body = ",\n".join(json.dumps(row, ensure_ascii=False) for row in rows)
    OUT.write_text(f"[\n{body}\n]\n", encoding="utf-8")

    print(f"wrote {len(rows)} countries to {OUT}")
    print("by continent:", dict(sorted(Counter(row["continent"] for row in rows).items())))


if __name__ == "__main__":
    main()
