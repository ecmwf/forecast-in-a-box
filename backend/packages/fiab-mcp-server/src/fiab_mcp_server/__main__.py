# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""Main entrypoint for the MCP server."""

import argparse
import asyncio
import logging
import os

from fiab_mcp_server.server import FiabMcpServer


def main() -> None:
    """Main entrypoint for the MCP server."""
    if os.environ.get("FIAB_MCP_LOGGING") == "1":
        logging.basicConfig(
            level=logging.DEBUG,
            filename="/tmp/fiabMcp.log",
            format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        )

    parser = argparse.ArgumentParser(description="Forecast in a Box MCP Server")
    parser.add_argument("--url", required=True, help="Base URL of the FIAB backend (e.g., http://localhost:8000)")
    args = parser.parse_args()

    server = FiabMcpServer(args.url)
    asyncio.run(server.run())


if __name__ == "__main__":
    main()
