# Installation
* If on MacOS, you may be required to `brew install fftw` first when using older versions of the `atlas` library in the workflows.
* If you get `Cache is currently in-use, waiting for other uv process to finish` whenever running `fiab.sh`, this signifies there is another `uv` process running or hanging on your system. You can either:
  1. locate it and terminate it (this applies to when you explicitly use `uv` yourself elsewhere),
  2. run `uv cache prune --force` (this applies when you are not aware of `uv` being executed, and should just solve the problem), then run your `fiab.sh` again as you did before.

# Infrastructure / Environment
* `ExecutorFailure(host='h0', detail="ValueError('process on h0.w0 failed to terminate correctly: 1814799 -> -11')")` -- possibly venv incompatibility. You submit from a different venv that executors are using, leading to unstable cloudpickle behaviour. Make sure the venvs are the same, or use JobInstances without cloudpickle.
* Server not getting any remote traffic, ie, when curling from localhost all works, but from outside the HTTP connection is set up (so it's not a firewall problem) but no actual packets flow -- make sure the device (presumably Mac) has the dialog "allow application Python to receive network traffic" approved.
* `69:77: execution error: Can't get application "chrome". (-1728)` -- use `fiab__general__launch_browser=False` or install any browser on the machine
* `Library not loaded: /opt/homebrew/opt/fftw/lib/libfftw3.3.dylib` -- run `brew install fftw` (or wait for this getting fixed on Mac)
* unpickle issue with `pathlib._local` -- use python3.12+
* `zmq.error.ZMQError: Operation not supported by device` -- issue on Mac with incorrect self-host detection, should be covered by cascade's platform module

# Model Checkpoints
* `ValueError(TaskFailure(worker=h0.w1, task='run_as_earthkit:97b3503430ebbc42fec29533c043672907647970346c53cce4f4fa8d53f27fc0', detail='AttributeError("module \'torch.mps\' has no attribute \'current_device\'")'))` and similar -- model hardcodes CUDA. Make sure you have sufficiently high versions of the anemoi stack
  * Similarly, `ModuleNotFoundError: No module named 'flash_attn'` is a sign of a non-portable checkpoint
* something like `"cannot install anemoi-models-x.y.z.local1"` -- model was trained with local modifications that aren't on pypi
* `ValueError: ExecutorFailure(host='h0', detail="ValueError('process on h0.w0 failed to terminate correctly: 2488 -> -6')")` -- this *could* mean incompatible versions, like model checkpoint being pickled with torch geometric < 2.4 but unpickled with >= 2.4, or being pickled multiple times in a forked process -- if you are on Mac, preferably don't use fork/forkserver in combination with torch, even with the disable safety envar set to true (fiab by default only spawns on Mac)
  * A similar error caused by fork/forkserver on Mac manifests as ` ValueError: {'progress': '0.00', 'status': 'errored', 'created_at': '2025-08-06 13:50:02.147142', 'error': 'ValueError(TaskFailure(worker=h0.w5, task=\'run_as_earthkit:bcc898d809ec13faed614e3f64f10158a1f9e2b65ad7ef18114e2096c62b0002\', detail="SyntaxError(\'Compiler encountered XPC_ERROR_CONNECTION_INVALID (is the OS shutting down?)\')"))'}`
