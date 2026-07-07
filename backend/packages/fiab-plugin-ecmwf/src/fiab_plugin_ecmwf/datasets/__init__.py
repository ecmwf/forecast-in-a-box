import os
from dataclasses import dataclass
from importlib.resources import files
from typing import Literal, Optional

import yaml
from pymetkit import ParamDB
from qubed import Qube


@dataclass(frozen=True, eq=True, slots=True)
class ForecastDataset:
    datacubes: list[dict]
    member_zero: Optional[dict] = None
    param_db_origin: Optional[int] = None

    def as_qube(self, ens_dim: str = "number", include_member_zero: bool = False, **extra: dict) -> Qube:
        qube = Qube.empty()
        paramdb = ParamDB()
        for datacube in self.datacubes:
            datacube = datacube.copy()
            datacube.update(extra)
            datacube["param"] = [
                str(paramdb.shortname_to_param_id(shortname, origin=self.param_db_origin)) for shortname in datacube["param"]
            ]
            if ens_dim and self.is_member_zero(datacube):
                if ens_dim in datacube:
                    raise ValueError(f"Datacube for member zero should not contain ensemble dim: `{ens_dim}`")
                if include_member_zero:
                    datacube = datacube.copy()
                    datacube[ens_dim] = [0]
                    new_qube = Qube.from_datacube(dict(sorted(datacube.items())))
                else:
                    new_qube = Qube.from_datacube(dict(sorted(datacube.items())))
                    new_qube.add_metadata({ens_dim: 0})
            else:
                new_qube = Qube.from_datacube(dict(sorted(datacube.items())))
            qube = qube | new_qube
        return qube

    def is_member_zero(self, datacube: dict) -> bool:
        if not self.member_zero:
            return False
        return all([self.member_zero[key] in datacube[key] for key in self.member_zero])


def load_datasets() -> dict[str, ForecastDataset]:
    datasets = {}
    for filepath in files("fiab_plugin_ecmwf.datasets.configs").iterdir():
        filepath = str(filepath)
        if os.path.isfile(filepath):
            name = os.path.splitext(os.path.basename(filepath))[0]
            with open(filepath, "r") as f:
                config = yaml.safe_load(f)
            datasets[name] = ForecastDataset(**config)
    return datasets
