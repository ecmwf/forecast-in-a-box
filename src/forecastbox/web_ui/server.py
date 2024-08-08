"""
The fast-api server providing the static html for submitting new jobs, and retrieving status or results of submitted jobs

endpoints:
  [get]  /			=> index.html with text boxes for job params)
  [post] /submit		=> launches new jobs with params, returns job.html with JobStatus)
  [get]  /jobs/{job_id}	=> returns job.html with JobStatus / JobResult
"""

from typing_extensions import Self
from fastapi import FastAPI, Form, Request, HTTPException
from typing import Annotated, Optional
from starlette.responses import HTMLResponse
import jinja2
import pkgutil
from forecastbox.api.controller import JobDefinition, JobStatus, JobFunctionEnum
import logging
import os
import httpx

logger = logging.getLogger("uvicorn." + __name__)  # TODO instead configure uvicorn the same as the app
app = FastAPI()


class StaticExecutionContext:
	"""Provides static files and URLs.
	Encapsulates accessing config and interacting with package data.
	Initializes lazily to make this module importible outside execution context."""

	_instance: Optional[Self] = None

	@classmethod
	def get(cls) -> Self:
		if not cls._instance:
			cls._instance = cls()
		return cls._instance

	def __init__(self) -> None:
		# urls
		self.job_submit_url = f"{os.environ['FIAB_CTR_URL']}/jobs/submit"
		self.job_status_url = lambda job_id: f"{os.environ.get('FIAB_CTR_URL', '')}/jobs/status/{job_id}"

		# static html
		index_html_raw = pkgutil.get_data("forecastbox.web_ui.static", "index.html")
		if not index_html_raw:
			raise FileNotFoundError("index.html")
		self.index_html = index_html_raw.decode()

		# templates
		template_env = jinja2.Environment()
		job_template_raw = pkgutil.get_data("forecastbox.web_ui.static", "job.html")
		if not job_template_raw:
			raise FileNotFoundError("job.html")
		self.template_job = template_env.from_string(job_template_raw.decode())

		# from fastapi.staticfiles import StaticFiles
		# app.mount("/static", StaticFiles(directory="static"), name="static") # TODO for styles.css etc


@app.api_route("/status", methods=["GET", "HEAD"])
async def status_check() -> str:
	return "ok"


@app.get("/", response_class=HTMLResponse)
async def index() -> str:
	return StaticExecutionContext.get().index_html


@app.post("/submit", response_class=HTMLResponse)
async def submit(request: Request, start_date: Annotated[str, Form()], end_date: Annotated[str, Form()]) -> str:
	# TODO read job function enum from some dropdown/choice in the Form
	job_definition = JobDefinition(
		function_name=JobFunctionEnum.hello_world, function_parameters={"start_date": start_date, "end_date": end_date}
	)
	async with httpx.AsyncClient() as client:  # TODO pool the client
		response_raw = await client.put(StaticExecutionContext.get().job_submit_url, json=job_definition.model_dump())
		if response_raw.status_code != httpx.codes.OK:
			logger.error(response_raw.status_code)
			logger.error(response_raw.text)
			raise HTTPException(status_code=500, detail="Internal Server Error")
		response_json = response_raw.json()  # TODO how is this parsed? Orjson?
		job_status = JobStatus(**response_json)
	# TODO we dont really want to redirect since we *have* the status, but it would be nice to change the url for easier refresh
	# redirect_url = request.url_for("job_status", job_id=job_status.job_id.job_id)
	# return RedirectResponse(redirect_url, status_code=status.HTTP_303_SEE_OTHER)
	template_params = {**job_status.model_dump(), "refresh_url": f"jobs/{job_status.job_id.job_id}"}
	return StaticExecutionContext.get().template_job.render(template_params)


@app.get("/jobs/{job_id}", response_class=HTMLResponse)
async def job_status(request: Request, job_id: str) -> str:
	async with httpx.AsyncClient() as client:  # TODO pool the client
		response_raw = await client.get(StaticExecutionContext.get().job_status_url(job_id))
		if response_raw.status_code != httpx.codes.OK:
			logger.error(response_raw.status_code)
			logger.error(response_raw.text)
			raise HTTPException(status_code=500, detail="Internal Server Error")
		response_json = response_raw.json()  # TODO how is this parsed? Orjson?
		job_status = JobStatus(**response_json)
	template_params = {**job_status.model_dump(), "refresh_url": f"../jobs/{job_status.job_id.job_id}"}
	return StaticExecutionContext.get().template_job.render(template_params)
