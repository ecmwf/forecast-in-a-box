# Useful Recipes and HowTos
## Configuration
See the config.py in backend for overview of whats possible.
You can either modify your config toml file in your `FIAB_ROOT` (typically `~/.fiab`), or export them as environment variables (e.g. `fiab__auth__passthrough=True` for setting the `auth.passthrough` config value).

Also see the fiab.sh for environment variables which modify the package behaviour (like the already mentioned fiab root).

## How to get logs
Often you get `TaskFailure(detail="something went wrong but there are no details", worker="h0.w1")` in the logs, but not the stack trace itself.
This is because executor logs don't go to the stdout generally -- only the fiab server logs end up there.
To get the full stacktrace and full history, you can either:
1. call the logs endpoint, `api/v1/gateway/logs`, which will return you a zip file with all the log files (this is useful for pair debugging),
2. pick the logs from the file system -- the gateway logs at the start a line like `logging base is at {Globals.logs_directory.name}` which tells you where the folder with all logs is located (most likely something like `/tmp/fiabLogs<something>`, you can also just ls and pick by date),
3. export `FIAB_LOGSTDOUT=yea` before you start your fiab process -- then you will not get logging into the files, but everything will be in the standout.

Keep in mind there is a lot of logs, which makes the third option at times unpractical. The file-based logging separates logs from controller, gateway, executors, etc. In this example we would find the stacktrace in the file with `h0.w1` in name, though in some cases logs of the controller or other workers may be relevant as well.
