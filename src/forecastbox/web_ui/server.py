"""
The fast-api server providing the static html for submitting new jobs, and retrieving status or results of submitted jobs

endpoints:
  [get]  /			=> index.html with text boxes for job params)
  [post] /submit		=> launches new jobs with params, returns job.html with JobStatus)
  [get]  /jobs/{job_id}	=> returns job.html with JobStatus / JobResult
"""

from fastapi import FastAPI, Form, Request
from typing import Annotated
from starlette.responses import FileResponse, HTMLResponse
from fastapi.templating import Jinja2Templates
from forecastbox.api.controller import JobDefinition, JobStatus
import logging
import os
import httpx

logger = logging.getLogger("uvicorn." + __name__)  # TODO instead configure uvicorn the same as the app
app = FastAPI()
# from fastapi.staticfiles import StaticFiles
# app.mount("/static", StaticFiles(directory="static"), name="static") # TODO for styles.css etc
templates = Jinja2Templates(directory="static")


@app.api_route("/status", methods=["GET", "HEAD"])
async def status_check() -> str:
	return "ok"


@app.get("/")
async def index() -> FileResponse:
	return FileResponse("static/index.html")


job_submit_url = f"{os.environ['FIAB_CTR_URL']}/jobs/submit"
job_status_url = lambda job_id: f"{os.environ['FIAB_CTR_URL']}/jobs/{job_id}"


@app.post("/submit")
async def submit(request: Request, start_date: Annotated[str, Form()], end_date: Annotated[str, Form()]) -> HTMLResponse:
	logger.debug(f"form params: {start_date=}, {end_date=}")
	job_definition = JobDefinition(function_name="hello_world", function_parameters={"start_date": start_date, "end_date": end_date})
	async with httpx.AsyncClient() as client:  # TODO pool the client
		response_raw = await client.put(job_submit_url, json=job_definition.dict())
		if response_raw.status_code != httpx.codes.OK:
			logger.error(response_raw.status_code)
			logger.error(response_raw.text)
			# TODO return error
		response_json = response_raw.json()  # TODO how is this parsed? Orjson?
		job_status = JobStatus(**response_json)
	# redirect_url = request.url_for("job_status", job_id=job_status.job_id.job_id)
	# return RedirectResponse(redirect_url, status_code=status.HTTP_303_SEE_OTHER)
	return templates.TemplateResponse(request=request, name="job.html", context={"job_id": job_status.job_id.job_id})


@app.get("/jobs/{job_id}", response_class=HTMLResponse)
async def job_status(request: Request, job_id: str) -> HTMLResponse:
	# TODO controller request, fill in context
	return templates.TemplateResponse(request=request, name="job.html", context={"job_id": job_id})
