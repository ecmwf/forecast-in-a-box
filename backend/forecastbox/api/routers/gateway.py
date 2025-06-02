# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from dataclasses import dataclass
from typing import Literal
from sse_starlette.sse import EventSourceResponse
import subprocess
import asyncio
from datetime import datetime

from threading import Thread
from queue import Queue

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from forecastbox.db import async_db as db

from forecastbox.config import config

logs_collection = db["process_logs"]
processes = {}


async def shutdown_processes():
    """Terminate all running processes on shutdown."""
    # Terminate all running subprocesses
    for pid, proc in processes.items():
        if proc.poll() is None:
            proc.terminate()
        await logs_collection.delete_many({"process_id": pid})


router = APIRouter(
    tags=["gateway"],
    responses={404: {"description": "Not found"}},
    on_shutdown=[shutdown_processes],
)

PROCESS_ID = "cascade_gateway"
STATUS = Literal["running", "terminated", "not running"]


@dataclass
class ProcessStatus:
    """Represent the status of a process."""

    process_id: str
    """Unique identifier for the process."""
    status: STATUS
    """Current status of the process (e.g., 'running', 'terminated', 'not running')."""


@router.post("/start")
async def start_process() -> ProcessStatus:
    """
    Start the Cascade Gateway process.
    """
    proc_id = PROCESS_ID

    if proc_id in processes:
        raise HTTPException(503, "Process already running.")

    command_prefix = None
    try:
        subprocess.run(["python", "--version"], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        command_prefix = ["python"]
    except FileNotFoundError:
        pass

    try:
        subprocess.run(["uv", "--version"], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        command_prefix = ["uv", "run", "python"]
    except FileNotFoundError:
        pass

    if command_prefix is None:
        raise HTTPException(404, "Neither Python nor uv found. Cannot start process.")

    process = subprocess.Popen(
        ["stdbuf", "-oL", *command_prefix, "-u", "-m", "cascade.gateway", config.cascade.cascade_url],
        # ['echo', 'Hello, World!', f"{command_prefix}"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    processes[proc_id] = process

    asyncio.create_task(capture_logs(proc_id, process))
    return ProcessStatus(process_id=proc_id, status="running")


async def capture_logs(proc_id: str, process):
    """
    Capture logs from the subprocess and store them in the database.
    """
    q = Queue()

    def reader():
        for line in process.stdout:
            q.put(line.strip())

    # Run reader in a background thread
    Thread(target=reader, daemon=True).start()

    while True:
        try:
            line = await asyncio.get_event_loop().run_in_executor(None, q.get)
        except Exception as e:
            print(f"Error reading log: {e}")
            break

        await logs_collection.insert_one({"process_id": proc_id, "timestamp": datetime.now(), "log": line})

        collection_size = await logs_collection.count_documents({})
        if collection_size > config.cascade.log_collection_max_size:
            oldest_log = await logs_collection.find_one(sort=[("timestamp", 1)])
            if oldest_log:
                await logs_collection.delete_one({"_id": oldest_log["_id"]})

        if process.poll() is not None and q.empty():
            print(f"[capture_logs] Process {proc_id} ended")
            break


@router.get("/status")
async def get_status() -> ProcessStatus:
    """Get the status of the Cascade Gateway process."""
    process = processes.get(PROCESS_ID)
    if process and process.poll() is None:
        return ProcessStatus(process_id=PROCESS_ID, status="running")
    else:
        return ProcessStatus(process_id=PROCESS_ID, status="not running")


@router.get("/logs")
async def stream_logs(request: Request) -> StreamingResponse:
    """Stream logs from the Cascade Gateway process."""
    process_id = PROCESS_ID
    last_id = None

    async def event_generator():
        nonlocal last_id

        # Stream past logs
        docs = await logs_collection.find({"process_id": process_id}).sort("_id").to_list(100)
        for doc in docs:
            last_id = doc["_id"]
            yield {"event": "log", "data": doc["log"]}

        # Poll for new logs forever (or until disconnected)
        while True:
            if await request.is_disconnected():
                print("Client disconnected.")
                break

            query = {"process_id": process_id}
            if last_id:
                query["_id"] = {"$gt": last_id}

            docs = await logs_collection.find(query).sort("_id").to_list(100)
            for doc in docs:
                last_id = doc["_id"]
                yield {"event": "log", "data": doc["log"]}

            await asyncio.sleep(1)

    return EventSourceResponse(event_generator())


@router.post("/kill")
async def kill_process() -> ProcessStatus:
    """Kill the Cascade Gateway process."""
    process = processes.pop(PROCESS_ID, None)
    await logs_collection.delete_many({"process_id": PROCESS_ID})

    if process and process.poll() is None:
        process.terminate()
        return ProcessStatus(process_id=PROCESS_ID, status="terminated")

    return ProcessStatus(process_id=PROCESS_ID, status="not running")
