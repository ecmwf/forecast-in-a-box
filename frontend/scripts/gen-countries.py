#!/usr/bin/env python3
# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.

"""Generate the static country assets for the geodomain picker.

Writes both ``countries.json`` (the searchable list, grouped by continent) and
``countries.geo.json`` (simplified polygons for the map) from one pass over the same records,
so the two committed assets can never disagree on the name set.

Run once (this is NOT part of the build) with a Python that has cartopy + earthkit-plots
installed, e.g. the backend venv::

    backend/.venv/bin/python frontend/scripts/gen-countries.py

Names come from Natural Earth 110m ``admin_0_map_units`` ``NAME_LONG`` -- the source
earthkit-plots' ``NaturalEarthDomain`` matches first (case insensitively) -- so the polygon
shown in the picker is the domain the backend resolves (e.g. "France" = metropolitan). Every
name is additionally probe-resolved through earthkit-plots' ``Domain.from_string``; names it
cannot resolve are dropped and reported, so the shipped list is resolvable by construction.
Geometry is simplified and coordinates rounded to keep the asset small; it is lazy-loaded
inside the (already lazy) map chunk. Only re-run this script to refresh the assets.
"""

import json
from collections import Counter
from pathlib import Path

import cartopy.io.shapereader as shpreader
from earthkit.plots.geo.domains import Domain
from shapely.geometry import mapping

DATA_DIR = Path(__file__).resolve().parents[1] / "src/components/base/fields/data"
LIST_OUT = DATA_DIR / "countries.json"
GEOJSON_OUT = DATA_DIR / "countries.geo.json"
# Polar / uninhabited groupings that would each form a one-item continent group.
DROP_CONTINENTS = {"Antarctica", "Seven seas (open ocean)"}
SIMPLIFY_TOLERANCE = 0.15  # degrees
COORD_DECIMALS = 2


def _round_coords(node):
    if isinstance(node, (list, tuple)):
        if node and isinstance(node[0], (int, float)):
            return [round(float(value), COORD_DECIMALS) for value in node]
        return [_round_coords(child) for child in node]
    return node


def _resolves(name: str) -> Exception | None:
    """Probe the backend resolution path; returns the failure, or None if *name* resolves."""
    try:
        Domain.from_string(name)
    except Exception as err:
        return err
    return None


def main() -> None:
    shapefile = shpreader.natural_earth(resolution="110m", category="cultural", name="admin_0_map_units")
    seen: set[str] = set()
    dropped: list[tuple[str, Exception]] = []
    rows: list[dict[str, str]] = []
    features: list[dict] = []
    for record in shpreader.Reader(shapefile).records():
        name = (record.attributes.get("NAME_LONG") or "").replace("\x00", "").strip()
        continent = (record.attributes.get("CONTINENT") or "").replace("\x00", "").strip()
        if not name or continent in DROP_CONTINENTS or name in seen:
            continue
        seen.add(name)
        if (err := _resolves(name)) is not None:
            dropped.append((name, err))
            continue
        rows.append({"name_long": name, "continent": continent or "Other"})
        geometry = mapping(record.geometry.simplify(SIMPLIFY_TOLERANCE, preserve_topology=True))
        geometry = {**geometry, "coordinates": _round_coords(geometry["coordinates"])}
        features.append({"type": "Feature", "properties": {"name_long": name}, "geometry": geometry})

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    rows.sort(key=lambda row: (row["continent"], row["name_long"]))
    body = ",\n".join(json.dumps(row, ensure_ascii=False) for row in rows)
    LIST_OUT.write_text(f"[\n{body}\n]\n", encoding="utf-8")

    features.sort(key=lambda feature: feature["properties"]["name_long"])
    collection = {"type": "FeatureCollection", "features": features}
    GEOJSON_OUT.write_text(json.dumps(collection, separators=(",", ":")), encoding="utf-8")

    print(f"wrote {len(rows)} countries to {LIST_OUT}")
    print(f"wrote {len(features)} features, {GEOJSON_OUT.stat().st_size // 1024} KB -> {GEOJSON_OUT}")
    print("by continent:", dict(sorted(Counter(row["continent"] for row in rows).items())))
    for name, err in dropped:
        print(f"DROPPED {name!r}: earthkit-plots cannot resolve it ({type(err).__name__}: {err})")


if __name__ == "__main__":
    main()
