"""
The fast-api server providing the static html for submitting new jobs, and retrieving status or results of submitted jobs

endpoints:
  [get]  /			=> index.html with text boxes for job params)
  [post] /submit		=> launches new jobs with params, returns job.html with JobStatus)
  [get]  /jobs/{job_id}	=> returns job.html with JobStatus / JobResult
"""

from fastapi import FastAPI, Form
from typing import Annotated
from starlette.responses import FileResponse
import logging

logger = logging.getLogger(__name__)
app = FastAPI()


@app.api_route("/status", methods=["GET", "HEAD"])
def status() -> str:
	return "ok"


@app.get("/")
def index() -> FileResponse:
	return FileResponse("static/index.html")


@app.post("/submit")
def submit(start_date: Annotated[str, Form()], end_date: Annotated[str, Form()]) -> str:
	logger.info(f"form params: {start_date=}, {end_date=}")
	return "ok"
