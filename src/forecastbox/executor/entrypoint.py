"""
The wrapper for executing ExecutableSubgraph with various contexts
"""

# TODO unify this with worker/entrypoint

import time
import os
from typing import Callable, Any, Literal
import cascade.shm.client as shm_client
from forecastbox.executor.futures import DataFuture
from cascade.executors.dask_futures import ExecutableSubgraph, ExecutableTaskInstance
from cascade.low.core import TaskDefinition, NO_OUTPUT_PLACEHOLDER, DatasetId
from cascade.controller.core import Event, TaskStatus, DatasetStatus
from contextlib import AbstractContextManager
from multiprocessing.connection import Connection
from forecastbox.worker.environment_manager import Environment
from forecastbox.worker.entrypoint import ExceptionReporter
import forecastbox.worker.serde as serde
from forecastbox.utils import logging_config, ensure, maybe_head
import logging
import importlib
from cascade.controller.tracing import mark, label, TaskLifecycle, Microtrace, timer, trace

logger = logging.getLogger(__name__)


def get_callable(task: TaskDefinition) -> Callable:
	if task.func is not None:
		return TaskDefinition.func_dec(task.func)
	elif task.entrypoint is not None:
		module_name, function_name = task.entrypoint.rsplit(".", 1)
		module = importlib.import_module(module_name)
		return module.__dict__[function_name]
	else:
		raise TypeError("neither entrypoint nor func given")


class ExecutionMemoryManager(AbstractContextManager):
	"""Handles opening and closing of SharedMemory objects, including their SerDe, within single task execution"""

	# TODO this should somehow merge with the shmdb

	mems: dict[str, shm_client.AllocatedBuffer]

	def __init__(self) -> None:
		self.mems: dict[str, shm_client.AllocatedBuffer] = {}

	def get(self, shmid: str, annotation: str) -> Any:
		if shmid not in self.mems:
			logger.debug(f"opening dataset {shmid}")
			self.mems[shmid] = shm_client.get(shmid)
		raw = self.mems[shmid].view()
		rv = timer(serde.from_bytes, Microtrace.wrk_deser)(raw, annotation)
		logger.debug(f"deser into {annotation} done")
		return rv

	def put(self, data: Any, shmid: str, annotation: str) -> None:
		result_ser = timer(serde.to_bytes, Microtrace.wrk_ser)(data, annotation)
		l = len(result_ser)
		rbuf = shm_client.allocate(shmid, l)
		rbuf.view()[:l] = result_ser
		rbuf.close()

	def __exit__(self, exc_type, exc_val, exc_tb) -> Literal[False]:
		for mem in self.mems.values():
			mem.close()
		return False


def task_entrypoint(
	task: ExecutableTaskInstance, local_mems: dict[DatasetId, Any], sh_mems: ExecutionMemoryManager, published_outputs: set[DatasetId]
) -> None:
	mark({"task": task.name, "action": TaskLifecycle.started})
	start = time.perf_counter_ns()

	args: list[Any] = []
	for idx, arg in task.task.static_input_ps.items():
		ensure(args, idx)
		args[idx] = arg
	kwargs: dict[str, Any] = {}
	kwargs.update(task.task.static_input_kw)
	for wiring in task.wirings:
		if wiring.source in local_mems:
			logger.debug(f"obtaining input {wiring.source} from proc memory")
			value = local_mems[wiring.source]
		else:
			logger.debug(f"obtaining input {wiring.source} from shm")
			shmid = DataFuture.fromDsId(wiring.source).asShmId()
			value = sh_mems.get(shmid, wiring.annotation)
		if wiring.intoPosition is not None:
			ensure(args, wiring.intoPosition)
			args[wiring.intoPosition] = value
		if wiring.intoKwarg is not None:
			kwargs[wiring.intoKwarg] = value

	if len(task.task.definition.output_schema) > 1:
		raise NotImplementedError("multiple outputs not supported yet")
	output_key = maybe_head(task.task.definition.output_schema.keys())
	if not output_key:
		raise ValueError(f"no output key for task {task.name}")
	mark({"task": task.name, "action": TaskLifecycle.loaded})

	prep_end = time.perf_counter_ns()
	logger.debug(f"running {task.name} with {args=} and {kwargs=}")
	kallable = get_callable(task.task.definition)
	result = kallable(*args, **kwargs)
	run_end = time.perf_counter_ns()
	mark({"task": task.name, "action": TaskLifecycle.computed})

	output_schema = task.task.definition.output_schema[output_key]
	if output_key == NO_OUTPUT_PLACEHOLDER:
		if result is not None:
			logger.warning(f"gotten output of type {type(result)} where none was expected, updating annotation")
			output_schema = "Any"
		else:
			result = "ok"
	output_dsid = DatasetId(task.name, output_key)
	local_mems[output_dsid] = result
	if output_dsid in published_outputs:
		shmid = DataFuture.fromDsId(output_dsid).asShmId()
		sh_mems.put(result, shmid, output_schema)

	# this is required so that the Shm can be properly freed
	# if you ever get 'pointers cannot be closed' bug, deleting args[i] individually etc
	del args
	del kwargs

	end = time.perf_counter_ns()

	mark({"task": task.name, "action": TaskLifecycle.published})
	trace(Microtrace.wrk_task, end - start)
	logger.debug(f"outer elapsed {(end-start)/1e9: .5f} s in {task.name}")
	trace(Microtrace.wrk_load, prep_end - start)
	logger.debug(f"prep elapsed {(prep_end-start)/1e9: .5f} s in {task.name}")
	trace(Microtrace.wrk_compute, run_end - prep_end)
	logger.debug(f"inner elapsed {(run_end-prep_end)/1e9: .5f} s in {task.name}")
	trace(Microtrace.wrk_publish, end - run_end)
	logger.debug(f"post elapsed {(end-run_end)/1e9: .5f} s in {task.name}")


def gpu_torch_quickwin(self, worker_id: str) -> None:
	# TODO drop this and solve properly in cascade.worker. The existence
	# of gpu should be declared in the config.sh, affect the slurm queue *and*
	# zmq spec, which should propagate to Environment, from which it should end up
	# here, including properly derived id
	if os.environ.get("CASCADE_GPU") == "WOOHOO":
		gpu_id = worker_id.split(":", 1)[1][1:]
		os.environ["CUDA_VISIBLE_DEVICES"] = gpu_id


def entrypoint(
	subgraph: ExecutableSubgraph, ex_pipe: Connection, tracingCtx: dict[str, str], event_callbacks: list[Callable[[Event], None]]
) -> None:
	worker = "unknown"
	try:
		worker = tracingCtx["worker"]
		gpu_torch_quickwin(worker)
		for k, v in tracingCtx.items():
			label(k, v)
		start = time.perf_counter_ns()
		local_mems: dict[DatasetId, Any] = {}
		with ExceptionReporter(ex_pipe), ExecutionMemoryManager() as sh_mems:
			logging.config.dictConfig(logging_config)
			for task in subgraph.tasks:
				environment = task.task.definition.environment
				with Environment(environment):
					task_entrypoint(task, local_mems, sh_mems, subgraph.published_outputs)
					# TODO del local_mems items that wont be needed later

		end = time.perf_counter_ns()
		logger.debug(f"subgraph elapsed {(end-start)/1e9: .5f} s")

		event = Event(
			at=worker,
			ts_trans=[(task.name, TaskStatus.succeeded) for task in subgraph.tasks],
			ds_trans=[(dataset, DatasetStatus.available) for dataset in subgraph.published_outputs],
		)
		for callback in event_callbacks:
			callback(event)
	except Exception:
		# TODO log becomes redundant once the ExceptionReporter's other end starts reporting/reacting -- remove by then
		# NOTE ideally rething the whole interaction between Callback and ExceptionReporter -- combine/coop?
		logger.exception("about to report task crash because of exception")
		event = Event(
			at=worker,
			ts_trans=[(task.name, TaskStatus.failed) for task in subgraph.tasks],
			ds_trans=[],
		)
		for callback in event_callbacks:
			callback(event)
