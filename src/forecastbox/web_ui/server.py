"""
The fast-api server providing the static html for submitting new jobs, and retrieving status or results of submitted jobs

endpoints:
  [get]  /			=> index.html with text boxes for job params)
  [post] /submit		=> launches new jobs with params, returns job.html with JobStatus)
  [get]  /jobs/{job_id}	=> returns job.html with JobStatus / JobResult
"""

from fastapi import FastAPI

app = FastAPI()


@app.get("/")
def index() -> dict[str, str]:
	return {"hello": "world"}
