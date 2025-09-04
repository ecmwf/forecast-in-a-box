# Installation

Everything is done via using the `fiab.sh` script.
Execute once in your terminal `curl https://github.com/ecmwf/forecast-in-a-box/blob/ae2c3afa4747238f00c41bbbb0c9eb7250757500/backend/fiab.sh -o fiab.sh`, or download the file by hand.
It is *not* recommended to download the whole git repository -- do that _only_ if you want to actively develop forecast-in-a-box itself, and in that case consult the respective guides instead.

Then just run `bash ./fiab.sh` every time you feel like forecasting something.

By default, this script upgrades itself regularly -- if you want to disable this, consult the [tuning and configuration](tuningAndConfiguration.md) guide.

# Usage
The run of the `fiab.sh` script should open a window in your browser, with url like `localhost:8000`.
See [troubleshooting](troubleshooting.md) if it doesn't.

For the usage of the browser app, TODO -- the current PoC won't be thoroughly documented, but once the next gen UI is in place, the docs will end up here
