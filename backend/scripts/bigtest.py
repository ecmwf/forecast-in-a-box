"""Executed from the bigtest github action"""

import datetime as dt
import logging
import os
import tempfile
import time

import httpx
from forecastbox.config import FIABConfig, config
from forecastbox.standalone.entrypoint import launch_all

logger = logging.getLogger("forecastbox.bigtest")

is_mars = os.getenv("FIAB_BIGTEST_ISMARS", "nay") == "yea"

def get_quickstart_job() -> dict:
    today = (dt.date.today() - dt.timedelta(2)).strftime("%Y%m%d")
    return {
        "job": {
            "job_type": "forecast_products",
            "model": {
                "model": "testing/o48-pretrained",
                "date": today + "T00",
                "lead_time": 42,
                "ensemble_members": 1,
                "entries": {} if is_mars else { 'input_preference': 'opendata', },
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
    handles = None
    dbDir = None
    dataDir = None
    try:
        config = FIABConfig()
        config.api.uvicorn_port = 30645
        config.auth.passthrough = True
        config.cascade.cascade_url = "tcp://localhost:30644"
        if os.environ.get("UNCLEAN", "") != "yea":
            dbDir = tempfile.TemporaryDirectory()
            config.db.sqlite_userdb_path = f"{dbDir.name}/user.db"
            config.db.sqlite_jobdb_path = f"{dbDir.name}/job.db"
            dataDir = tempfile.TemporaryDirectory()
            config.api.data_path = dataDir.name

        handles = launch_all(config, False, attempts=50)
        client = httpx.Client(base_url=config.api.local_url() + "/api/v1", follow_redirects=True)

        # download model
        client.post("/model/testing_o48-pretrained/download").raise_for_status()
        i = 100
        while True:
            if i <= 0:
                raise TimeoutError("no more retries")
            time.sleep(2)
            response = client.post("/model/testing_o48-pretrained/download").json()
            if response["status"] == "completed":
                break
            elif response["status"] in {"errored", "not_downloaded"}:
                raise ValueError(response)
            else:
                logger.debug(f"download in progress: {response}")
            i -= 1

        # execute "quickstart" job
        jobid = client.post("/execution/execute", json=get_quickstart_job(), timeout=10).json()["id"]
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
        if handles is not None:
            handles.shutdown()
        if dataDir is not None:
            dataDir.cleanup()
        if dbDir is not None:
            dbDir.cleanup()
