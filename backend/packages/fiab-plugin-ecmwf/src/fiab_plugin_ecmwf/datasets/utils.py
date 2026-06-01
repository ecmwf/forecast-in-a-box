import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import yaml
from qubed import Qube

LOCALDIR = Path(__file__).resolve().parent


@dataclass(frozen=True)
class ForecastDataset:
    datacubes: list[dict]
    member_zero: Optional[dict] = None

    def as_qube(self, ens_dim: str = "number", include_member_zero: bool = False) -> Qube:
        qube = Qube.empty()
        for datacube in self.datacubes:
            if ens_dim and self.is_member_zero(datacube):
                if ens_dim in datacube:
                    raise ValueError(f"Datacube for member zero should not contain ensemble dim: `{ens_dim}`")
                if include_member_zero:
                    datacube = datacube.copy()
                    datacube[ens_dim] = [0]
                    new_qube = Qube.from_datacube(datacube)
                else:
                    new_qube = Qube.from_datacube(datacube)
                    new_qube.add_metadata({ens_dim: 0})
            else:
                new_qube = Qube.from_datacube(datacube)
            qube = qube | new_qube
        return qube

    def is_member_zero(self, datacube: dict) -> bool:
        if not self.member_zero:
            return False
        return all([self.member_zero[key] in datacube[key] for key in self.member_zero])


def load_datasets() -> dict[str, ForecastDataset]:
    dataset_dir = os.path.join(LOCALDIR, "configs")
    datasets = {}
    for filepath in os.listdir(dataset_dir):
        fullpath = os.path.join(dataset_dir, filepath)
        if os.path.isfile(fullpath):
            name = os.path.splitext(filepath)[0]
            with open(fullpath, "r") as f:
                config = yaml.safe_load(f)
            datasets[name] = ForecastDataset(**config)
    return datasets
