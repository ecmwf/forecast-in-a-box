"""
Provisional module to contain:
 - catalog -- the user will, via `web_ui`, select an entity from here to submit to `controller`
 - implementations -- the `worker` will spawn a new process targetting a function from here
 - memlib -- a shared library used also by `worker`, for job code will obtain its inputs from the `worker` wrapper, and save its outputs back. A simple wrapper over `multiprocessing.shared_memory`
"""
