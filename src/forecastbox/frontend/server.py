"""
The fast-api server providing the static html for submitting new jobs, and retrieving status or results of submitted jobs

endpoints:
  [get]  /			=> index.html with text boxes for job params)
  [post] /submit		=> launches new jobs with params, returns job.html with JobStatus)
  [get]  /jobs/{job_id}	=> returns job.html with JobStatus / JobResult
"""

import orjson
from typing_extensions import Self, Union
from fastapi import FastAPI, Form, Request, HTTPException, status
from typing import Annotated, Optional
from starlette.responses import HTMLResponse, RedirectResponse
from starlette.datastructures import UploadFile
import jinja2
import pkgutil
from forecastbox.api.common import JobStatus, JobTemplateExample, TaskDAG, JobTemplate, RegisteredTask
import forecastbox.scheduler as scheduler
import forecastbox.plugins.lookup as plugin_lookup
import logging
import os
import httpx
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.responses import PlainTextResponse

logger = logging.getLogger("uvicorn." + __name__)  # TODO instead configure uvicorn the same as the app
app = FastAPI()
client_error = lambda e: HTTPException(status_code=400, detail=e)


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
		# index_html_raw = pkgutil.get_data("forecastbox.frontend.static", "index.html")
		# if not index_html_raw:
		# raise FileNotFoundError("index.html")
		# self.index_html = index_html_raw.decode()

		# templates
		template_env = jinja2.Environment()

		def get_template(fname: str) -> jinja2.Template:
			template_raw = pkgutil.get_data("forecastbox.frontend.static", fname)
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


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request, exc):
	# TODO perhaps a simple HTMLResponse instead
	if isinstance(exc.detail, list):
		s = "\n".join(exc.detail)
	else:
		s = str(exc.detail)
	return PlainTextResponse(s, status_code=exc.status_code)


@app.get("/", response_class=HTMLResponse)
async def index() -> str:
	"""The user selects which job type to submit"""
	template_params = {
		"jobs": [e.value for e in JobTemplateExample],
		"tasks": [f"{e.value}: {plugin_lookup.get_task(e).signature_repr()}" for e in RegisteredTask],
	}
	return StaticExecutionContext.get().template_index.render(template_params)


@app.post("/select")
async def select(request: Request, example_name: Annotated[str, Form()]) -> RedirectResponse:
	"""Takes job type, returns redirect to form for filling out job parameters"""
	redirect_url = request.url_for("prepare_example", example_name=example_name)
	return RedirectResponse(redirect_url, status_code=status.HTTP_303_SEE_OTHER)


def template_to_form_params(job_template: JobTemplate) -> list[tuple[str, str, str]]:
	return [
		(
			f"{task_name}.{param_name}",
			param.clazz,
			param.default,
		)
		for task_name, task_definition in job_template.tasks
		for param_name, param in task_definition.user_params.items()
	]


@app.get("/prepare_example/{example_name}", response_class=HTMLResponse)
async def prepare_example(example_name: str) -> str:
	"""The form for filling out job parameters and submitting the job itself, via a job template"""
	job_template = plugin_lookup.resolve_example(JobTemplateExample(example_name)).get_or_raise(client_error)
	template_params = {"job_name": example_name, "job_type": "example", "params": template_to_form_params(job_template)}
	return StaticExecutionContext.get().template_prepare.render(template_params)


@app.post("/prepare_builder", response_class=HTMLResponse)
async def prepare_builder(job_pipeline: Annotated[str, Form()]) -> str:
	"""The form for filling out job parameters and submitting the job itself, via custom built job"""
	task_pipeline = plugin_lookup.build_pipeline(job_pipeline).get_or_raise(client_error)
	template = plugin_lookup.resolve_builder_linear(task_pipeline).get_or_raise(client_error)
	template_params = {
		"job_name": job_pipeline,
		"job_type": "custom",
		"params": template_to_form_params(template),
	}
	return StaticExecutionContext.get().template_prepare.render(template_params)


async def submit_int(task_dag: TaskDAG) -> str:
	async with httpx.AsyncClient() as client:  # TODO pool the client
		response_raw = await client.put(StaticExecutionContext.get().job_submit_url, content=task_dag.model_dump_json().encode())
		if response_raw.status_code != httpx.codes.OK:
			logger.error(response_raw.status_code)
			logger.error(response_raw.text)
			raise HTTPException(status_code=500, detail="Internal Server Error")
		response_json = response_raw.json()  # TODO how is this parsed? Orjson?
		job_status = JobStatus(**response_json)
	return job_status.job_id.job_id


@app.post("/submit_form", response_model=None)
async def submit_form(request: Request) -> Union[RedirectResponse, TaskDAG]:
	form = await request.form()
	params = {k: v for k, v in form.items() if isinstance(v, str) and not k.startswith("fiab.int.")}
	job_type, job_name = params.pop("job_type"), params.pop("job_name")
	if job_type == "example":
		job_template = plugin_lookup.resolve_example(JobTemplateExample(job_name)).get_or_raise(client_error)
	elif job_type == "custom":
		task_pipeline = plugin_lookup.build_pipeline(job_name).get_or_raise(client_error)
		job_template = plugin_lookup.resolve_builder_linear(task_pipeline).get_or_raise(client_error)
	else:
		raise NotImplementedError(job_type)
	task_dag = scheduler.build(job_template, params).get_or_raise(client_error)
	if "fiab.int.action.launch" in form:
		job_id = await submit_int(task_dag)
		redirect_url = request.url_for("job_status", job_id=job_id)
		return RedirectResponse(redirect_url, status_code=status.HTTP_303_SEE_OTHER)
		# NOTE we dont really want to redirect since we *have* the status.
		# The code below returns that templated, but doesnt change URL so refresh wont work. Dont forget to add response_class=HTMLResponse
		# template_params = {**job_status.model_dump(), "refresh_url": f"jobs/{job_status.job_id.job_id}"}
		# return StaticExecutionContext.get().template_job.render(template_params)
	elif "fiab.int.action.store" in form:
		return task_dag
	else:
		raise NotImplementedError("not found any support form action")


@app.post("/submit_file")
async def submit_file(request: Request) -> RedirectResponse:
	form = await request.form()
	if not isinstance(form["config_file"], UploadFile):
		raise TypeError(type(form["config_file"]))
	contents = orjson.loads(await form["config_file"].read())
	task_dag = TaskDAG(**contents)
	job_id = await submit_int(task_dag)
	redirect_url = request.url_for("job_status", job_id=job_id)
	return RedirectResponse(redirect_url, status_code=status.HTTP_303_SEE_OTHER)


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
