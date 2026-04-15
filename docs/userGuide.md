# Installation

Everything is done via using the `fiab.sh` script.
Execute once in your terminal `curl https://github.com/ecmwf/forecast-in-a-box/blob/ae2c3afa4747238f00c41bbbb0c9eb7250757500/backend/fiab.sh -o fiab.sh`, or download the file by hand.
It is *not* recommended to download the whole git repository -- do that _only_ if you want to actively develop forecast-in-a-box itself, and in that case consult the respective guides instead.

Then just run `bash ./fiab.sh` every time you feel like forecasting something.

The script does not upgrade itself regularly -- you best run an upgrade from the web interface itself.
Alternatively, consult the script's help on how to run an upgrade or a full reinstall.

# Usage
The run of the `fiab.sh` script should open a window in your browser, with url like `localhost:8000`.
See [troubleshooting](troubleshooting.md) if it doesn't.

The browser app itself contains embedded help.
