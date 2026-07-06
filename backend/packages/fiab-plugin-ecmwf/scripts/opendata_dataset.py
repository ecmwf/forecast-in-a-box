#!/usr/bin/env -S uv run
# /// script
# dependencies = [
#    "ecmwf-opendata",
#    "beautifulsoup4",
#    "qubed",
# ]
# ///

import argparse
import json
from collections import defaultdict
from datetime import datetime, timedelta
from urllib.parse import urlparse

import requests
from ecmwf.opendata import Client
from qubed import Qube

EXCLUDE = [
    {"type": ["em", "es", "ep"]},
    {"levtype": ["sol"]},
    {"param": ["z", "sdor", "slor"], "levtype": ["sfc"]},
    {"param": ["z"], "levtype": ["pl"]},
]
SPLIT_BY = ["stream", "type", "levtype", "time"]
DROP = ["date"]
TYPES = {
    "number": int,
    "step": int,
    "levelist": int,
}

url = urlparse(Client().url)
top = url.scheme + "://" + url.netloc


def crawl(url: str, model: str, datacubes: dict) -> None:
    from bs4 import BeautifulSoup  # type: ignore

    r = requests.get(f"{top}{url}")
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    for link in soup.find_all("a"):
        href = link.get("href")
        if href is not None and href != url and href.startswith(url):
            if href.endswith("/"):
                crawl(href, model, datacubes)
            else:
                if href.endswith(".index"):
                    index_url = f"{top}{href}"
                    if f"/{model}/" not in index_url:
                        break

                    index_url = index_url.rstrip()
                    print(index_url)
                    r = requests.get(index_url)
                    r.raise_for_status()

                    for line in r.text.splitlines():
                        line = json.loads(line)
                        exclude = False
                        for criteria in EXCLUDE:
                            if all([(key in line and line[key] in values) for key, values in criteria.items()]):
                                exclude = True
                                break
                        if exclude:
                            continue
                        dcube = datacubes.setdefault(
                            "/".join([f"{split_key}={line[split_key]}" for split_key in SPLIT_BY]), defaultdict(set)
                        )
                        for k, v in line.items():
                            if not k.startswith("_"):
                                dcube[k].add(v)


if __name__ == "__main__":
    parser = argparse.ArgumentParser("Create dataset file from ECMWF open data catalogue")
    parser.add_argument("--model", type=str, default="ifs", help="Model to get catalogue for")
    parser.add_argument("--output", type=str, default="ifs-ens.yaml", help="Output filename")
    parser.add_argument("--member-zero", type=str, default="type=fc", help="Identifier for member zero")
    args = parser.parse_args()

    yesterday = datetime.now() - timedelta(days=1)
    base_url = url.path + ("" if url.path.endswith("/") else "/") + yesterday.strftime("%Y%m%d") + "/"
    datacubes = {}
    crawl(base_url, args.model, datacubes)
    qube = Qube.empty()
    for dcube in datacubes.values():
        final_qcube = {}
        for k, v in dcube.items():
            if k in DROP:
                continue
            if k in TYPES:
                v = list(map(TYPES[k], v))
            final_qcube[k] = sorted(v)
        qube = qube | Qube.from_datacube(final_qcube)
    qube = qube.compress()

    config = {}
    if len(args.member_zero) != 0:
        config["member_zero"] = {x.split("=")[0]: x.split("=")[1] for x in args.member_zero.split(",")}
    config["datacubes"] = [x for x in qube.datacubes()]
    with open(args.output, "w") as f:
        json.dump(config, f, indent=4)
