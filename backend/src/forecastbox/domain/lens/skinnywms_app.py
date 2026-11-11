# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""SkinnyWMS WSGI app for lens processes; importing it indexes `SKINNYWMS_DATA_PATH`.

Under gunicorn's `--preload` the index is built once in the master, and every
worker forked from it serves without scanning the data folder again.
"""

from skinnywms.wmssvr import application, server

server.availability.load()

__all__ = ["application"]
