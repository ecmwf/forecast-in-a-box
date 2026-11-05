# Troubleshooting

Please refer to the headings below for troubleshooting. Platform-specific help is available for **[macOS]**, **[Linux]** and **[containers]**.
For how to collect full logs, see [How to get logs](operator/tuningAndConfiguration.md#how-to-get-logs).

## Installation

* **[macOS]** You may need to install `fftw` first, if using older versions of the `atlas` library in the workflows.
* If you get `Cache is currently in-use, waiting for other uv process to finish` when running `fiab.sh`: this means there is another `uv` process running or hanging on your system. You can either:
  1. locate and terminate the process (this applies when explicitly using `uv` elsewhere),
  2. run `uv cache prune --force` (this applies when not aware of `uv` being executed), then re-run your `fiab.sh`.
* **[macOS]** `Library not loaded: /opt/homebrew/opt/fftw/lib/libfftw3.3.dylib` -- run `brew install fftw` (or wait for this to get fixed on Mac)
* unpickle issue with `pathlib._local` -- use python3.12+

## Network and browser

* **[macOS]** If the server is not getting any remote traffic, i.e. no packets flowing outside the HTTP connection although curling from localhost works (meaning not a firewall problem) -- make sure the device has the dialog `allow application Python to receive network traffic` approved.
* `69:77: execution error: Can't get application "chrome". (-1728)` -- set `launch_browser = false` in the `[backend]` section of `config.toml`, or export `fiab__backend__launch_browser=False`, or install any browser on the machine. The key is `backend.launch_browser`; older notes referred to `general.launch_browser`, which does not exist.

## Runtime and executors

* `ExecutorFailure(host='h0', detail="ValueError('process on h0.w0 failed to terminate correctly: 1814799 -> -11')")` -- this is likely due to venv incompatibility, for example when submittiing a different venv from that which executors are using, leading to unstable cloudpickle behaviour. Make sure the venvs are the same, or use JobInstances without cloudpickle.
* **[macOS]** `zmq.error.ZMQError: Operation not supported by device` -- issue with incorrect self-host detection, should be covered by cascade's platform module
* **[Linux] [containers]** `CascadeUserError('host=h0; process on h0.w0 failed to terminate correctly: 1859 -> -7')` -- the `-7` stands for `SIGBUS`, which often (though not always) suggests lack of `/dev/shm` memory, which is used by both cascade itself and by particular libraries such as `torch`. If you would see `df -h /dev/shm` returning particularly low values (like megabytes), ramp it up significantly (see for example `deployment/v2/justfile` for how we execute docker with extra shm)

## Model checkpoints

* `ValueError(TaskFailure(worker=h0.w1, task='run_as_earthkit:97b3503430ebbc42fec29533c043672907647970346c53cce4f4fa8d53f27fc0', detail='AttributeError("module \'torch.mps\' has no attribute \'current_device\'")'))` and similar -- model hardcodes CUDA. Make sure you have sufficiently high versions of the anemoi stack
  * Similarly, `ModuleNotFoundError: No module named 'flash_attn'` is a sign of a non-portable checkpoint
* something like `cannot install anemoi-models-x.y.z.local1` -- model was trained with local modifications that aren't on pypi
* `ValueError: ExecutorFailure(host='h0', detail="ValueError('process on h0.w0 failed to terminate correctly: 2488 -> -6')")` -- this *could* mean incompatible versions, e.g. model checkpoint being pickled with torch geometric < 2.4 but unpickled with >= 2.4, or being pickled multiple times in a forked process -- if you are on macOS, preferably don't use fork/forkserver in combination with torch, even with the disable safety envar set to true (fiab by default only spawns on macOS)
  * **[macOS]** A similar error caused by fork/forkserver manifests as ` ValueError: {'progress': '0.00', 'status': 'errored', 'created_at': '2025-08-06 13:50:02.147142', 'error': 'ValueError(TaskFailure(worker=h0.w5, task=\'run_as_earthkit:bcc898d809ec13faed614e3f64f10158a1f9e2b65ad7ef18114e2096c62b0002\', detail="SyntaxError(\'Compiler encountered XPC_ERROR_CONNECTION_INVALID (is the OS shutting down?)\')"))'}`
