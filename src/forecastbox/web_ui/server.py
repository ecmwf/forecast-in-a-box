"""
The fast-api server providing the static html for submitting new jobs, and retrieving status or results of submitted jobs

endpoints:
  [get]  /			=> index.html with text boxes for job params)
  [post] /submit		=> launches new jobs with params, returns job.html with JobStatus)
  [get]  /jobs/{job_id}	=> returns job.html with JobStatus / JobResult
"""

from typing_extensions import Self
from fastapi import FastAPI, Form, Request, HTTPException, status
from typing import Annotated, Optional
from starlette.responses import HTMLResponse, RedirectResponse
import jinja2
import pkgutil
from forecastbox.api.common import JobStatus, JobTypeEnum
import forecastbox.scheduler as scheduler
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
		# index_html_raw = pkgutil.get_data("forecastbox.web_ui.static", "index.html")
		# if not index_html_raw:
		# raise FileNotFoundError("index.html")
		# self.index_html = index_html_raw.decode()

		# templates
		template_env = jinja2.Environment()

		def get_template(fname: str) -> jinja2.Template:
			template_raw = pkgutil.get_data("forecastbox.web_ui.static", fname)
			if not template_raw:
				raise FileNotFoundError(fname)
			return template_env.from_string(template_raw.decode())

		self.template_job = get_template("job.html")
		self.template_index = get_template("index.html")
		self.template_prepare = get_template("prepare.html")

		# from fastapi.staticfiles import StaticFiles
		# app.mount("/static", StaticFiles(directory="static"), name="static") # TODO for styles.css etc


@app.api_route("/status", methods=["GET", "HEAD"])
async def status_check() -> str:
	return "ok"


@app.get("/", response_class=HTMLResponse)
async def index() -> str:
	"""The user selects which job type to submit"""
	template_params = {
		"jobs": [e.value for e in JobTypeEnum],
	}
	return StaticExecutionContext.get().template_index.render(template_params)


@app.post("/select")
async def select(request: Request, job_type: Annotated[str, Form()]) -> RedirectResponse:
	"""Takes job type, returns redirect to form for filling out job parameters"""
	redirect_url = request.url_for("prepare", job_type=job_type)
	return RedirectResponse(redirect_url, status_code=status.HTTP_303_SEE_OTHER)


@app.get("/prepare/{job_type}", response_class=HTMLResponse)
async def prepare(job_type: str) -> str:
	"""The form for filling out job parameters and submitting the job itself"""
	job_template = scheduler.prepare(JobTypeEnum(job_type))
	template_params = {
		"job_type": job_type,
		"params": [
			f"{task_name}.{param_name}" for task_name, task_definition in job_template.tasks for param_name in task_definition.param_names
		],
	}
	return StaticExecutionContext.get().template_prepare.render(template_params)


@app.post("/submit")
async def submit(request: Request) -> RedirectResponse:
	params = {k: v for k, v in (await request.form()).items() if isinstance(v, str)}
	job_template = scheduler.prepare(JobTypeEnum(params.pop("job_type")))
	task_dag = scheduler.build(job_template, params)
	async with httpx.AsyncClient() as client:  # TODO pool the client
		response_raw = await client.put(StaticExecutionContext.get().job_submit_url, json=task_dag.model_dump())
		if response_raw.status_code != httpx.codes.OK:
			logger.error(response_raw.status_code)
			logger.error(response_raw.text)
			raise HTTPException(status_code=500, detail="Internal Server Error")
		response_json = response_raw.json()  # TODO how is this parsed? Orjson?
		job_status = JobStatus(**response_json)
	redirect_url = request.url_for("job_status", job_id=job_status.job_id.job_id)
	return RedirectResponse(redirect_url, status_code=status.HTTP_303_SEE_OTHER)
	# NOTE we dont really want to redirect since we *have* the status.
	# The code below returns that templated, but doesnt change URL so refresh wont work. Dont forget to add response_class=HTMLResponse
	# template_params = {**job_status.model_dump(), "refresh_url": f"jobs/{job_status.job_id.job_id}"}
	# return StaticExecutionContext.get().template_job.render(template_params)


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
	job_status_dump = job_status.model_dump()
	job_status_dump["stages"] = list(
		(
			k,
			v,
		)
		for k, v in job_status_dump["stages"].items()
	)
	template_params = {**job_status_dump, "refresh_url": f"../jobs/{job_status.job_id.job_id}"}
	return StaticExecutionContext.get().template_job.render(template_params)
