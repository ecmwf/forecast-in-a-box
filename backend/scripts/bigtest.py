"""Executed from the bigtest github action"""

import datetime as dt
import time

import httpx
from forecastbox.config import config
from forecastbox.standalone.entrypoint import launch_all


def get_quickstart_job() -> dict:
    today = dt.date.today().strftime("%Y%m%d")
    return {
        "job": {
            "job_type": "forecast_products",
            "model": {
                "model": "testing/o48-pretrained",
                "date": today + "T00",
                "lead_time": 42,
                "ensemble_members": 1,
                "entries": {},
            },
            "products": [
                {
                    "product": "Plots/Maps",
                    "specification": {
                        "param": ["tp", "msl", "10u", "10v"],
                        "levtype": "sfc",
                        "domain": "Europe",
                        "reduce": "True",
                        "step": ["*"],
                    },
                },
                {
                    "product": "Standard/Output",
                    "specification": {
                        "param": ["tp", "msl", "10u", "10v"],
                        "levtype": "sfc",
                        "reduce": "True",
                        "format": "grib",
                        "step": ["*"],
                    },
                },
            ],
        },
        "environment": {"hosts": None, "workers_per_host": None, "environment_variables": {}},
        "shared": False,
    }


if __name__ == "__main__":
    try:
        handles = launch_all(config, False)
        client = httpx.Client(base_url=config.api.local_url() + "/api/v1", follow_redirects=True)

        # download model
        client.post("/model/testing_o48-pretrained/download").raise_for_status()
        i = 30
        while True:
            if i <= 0:
                raise TimeoutError("no more retries")
            time.sleep(1)
            response = client.post("/model/testing_o48-pretrained/download").json()
            if response["status"] == "completed":
                break
            elif response["status"] in {"errored", "not_downloaded"}:
                raise ValueError(response)
            i -= 1

        # execute "quickstart" job
        jobid = client.post("/execution/execute", json=get_quickstart_job()).json()["id"]
        url = f"/job/{jobid}/status"

        i = 600
        while True:
            if i <= 0:
                raise TimeoutError("no more retries")
            time.sleep(1)
            response = client.get(url).json()
            if response["status"] == "completed":
                break
            elif response["status"] == "running":
                i -= 1
                continue
            else:
                raise ValueError(response)

    finally:
        handles.shutdown()
