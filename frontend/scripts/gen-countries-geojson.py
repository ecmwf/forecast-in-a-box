#!/usr/bin/env python3
# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.

"""Generate simplified country polygons for the geodomain map picker.

Run once (NOT part of the build) with a Python that has cartopy + shapely, e.g. the backend venv::

    backend/.venv/bin/python frontend/scripts/gen-countries-geojson.py

Same source/resolution/attribute as ``gen-countries.py`` (Natural Earth 110m ``admin_0_countries``,
``NAME_LONG``) so clicking a polygon yields a name the backend can resolve. Geometry is simplified
and coordinates rounded to keep the asset small; it is lazy-loaded inside the (already lazy) map chunk.
"""

import json
from pathlib import Path

import cartopy.io.shapereader as shpreader
from shapely.geometry import mapping

OUT = Path(__file__).resolve().parents[1] / "src/components/base/fields/data/countries.geo.json"
DROP_CONTINENTS = {"Antarctica", "Seven seas (open ocean)"}
SIMPLIFY_TOLERANCE = 0.15  # degrees
COORD_DECIMALS = 2


def _round_coords(node):
    if isinstance(node, (list, tuple)):
        if node and isinstance(node[0], (int, float)):
            return [round(float(value), COORD_DECIMALS) for value in node]
        return [_round_coords(child) for child in node]
    return node


def main() -> None:
    shapefile = shpreader.natural_earth(resolution="110m", category="cultural", name="admin_0_countries")
    seen: set[str] = set()
    features: list[dict] = []
    for record in shpreader.Reader(shapefile).records():
        name = (record.attributes.get("NAME_LONG") or "").replace("\x00", "").strip()
        continent = (record.attributes.get("CONTINENT") or "").replace("\x00", "").strip()
        if not name or continent in DROP_CONTINENTS or name in seen:
            continue
        seen.add(name)
        geometry = mapping(record.geometry.simplify(SIMPLIFY_TOLERANCE, preserve_topology=True))
        geometry = {**geometry, "coordinates": _round_coords(geometry["coordinates"])}
        features.append({"type": "Feature", "properties": {"name_long": name}, "geometry": geometry})

    features.sort(key=lambda feature: feature["properties"]["name_long"])
    collection = {"type": "FeatureCollection", "features": features}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(collection, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(features)} features, {OUT.stat().st_size // 1024} KB -> {OUT}")


if __name__ == "__main__":
    main()
