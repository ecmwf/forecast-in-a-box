"""
The fast-api server providing the static html for submitting new jobs, and retrieving status or results of submitted jobs

endpoints:
  [get]  /			=> index.html with text boxes for job params)
  [post] /submit		=> launches new jobs with params, returns job.html with JobStatus)
  [get]  /jobs/{job_id}	=> returns job.html with JobStatus / JobResult
"""

from fastapi import FastAPI, Form, Request, status
from typing import Annotated
from starlette.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

# from fastapi.staticfiles import StaticFiles
import logging

logger = logging.getLogger("uvicorn." + __name__)  # TODO instead configure uvicorn the same as the app
app = FastAPI()
# app.mount("/static", StaticFiles(directory="static"), name="static") # TODO for styles.css etc
templates = Jinja2Templates(directory="static")


@app.api_route("/status", methods=["GET", "HEAD"])
async def status_check() -> str:
	return "ok"


@app.get("/")
async def index() -> FileResponse:
	return FileResponse("static/index.html")


@app.post("/submit")
async def submit(request: Request, start_date: Annotated[str, Form()], end_date: Annotated[str, Form()]) -> str:
	logger.debug(f"form params: {start_date=}, {end_date=}")
	# TODO controller request, obtain job_id
	job_id = "123"
	# redirect_url = request.url_for(f"/jobs/{job_id}")
	redirect_url = request.url_for("job_status", job_id=job_id)
	return RedirectResponse(redirect_url, status_code=status.HTTP_303_SEE_OTHER)


@app.get("/jobs/{job_id}", response_class=HTMLResponse)
async def job_status(request: Request, job_id: str) -> HTMLResponse:
	# TODO controller request, fill in context
	return templates.TemplateResponse(request=request, name="job.html", context={"job_id": job_id})
