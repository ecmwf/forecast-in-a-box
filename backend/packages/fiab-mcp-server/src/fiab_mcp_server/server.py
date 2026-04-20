# (C) Copyright 2024- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

"""MCP Server for Forecast in a Box - enables AI agents to build forecast workflows."""

import logging
from typing import Any

import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Resource, TextContent, Tool
from pydantic import AnyUrl

logger = logging.getLogger(__name__)


class FiabMcpServer:
    """MCP Server that interfaces with Forecast in a Box backend."""

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.client = httpx.AsyncClient(base_url=self.base_url, follow_redirects=True, timeout=30.0)
        self.server = Server("fiab_mcp_server")
        self._setup_handlers()

    def _setup_handlers(self) -> None:
        @self.server.list_resources()
        async def list_resources() -> list[Resource]:
            return [
                Resource(
                    uri=AnyUrl("fable://catalogue"),
                    name="Fable Catalogue",
                    mimeType="application/json",
                    description="Discover available block factories for building workflows",
                ),
                Resource(
                    uri=AnyUrl("fable://builders"),
                    name="Saved Builders",
                    mimeType="application/json",
                    description="List of saved workflow builders",
                ),
            ]

        @self.server.read_resource()
        async def read_resource(uri: AnyUrl) -> str:
            try:
                uri_str = str(uri)
                if uri_str == "fable://catalogue":
                    route = "api/v1/fable/catalogue"
                    logger.debug(f"GET {route}, params=None, body=None")
                    response = await self.client.get(route)
                    response.raise_for_status()
                    return response.text
                elif uri_str == "fable://builders":
                    return '{"message": "Listing builders not yet implemented - use fable_load with specific IDs"}'
                else:
                    raise ValueError(f"Unknown resource URI: {uri}")
            except httpx.HTTPStatusError as e:
                error_msg = f"HTTP {e.response.status_code} error: {e.response.text}"
                logger.error(f"Resource {uri} failed: {error_msg}")
                return f'{{"error": "{error_msg}"}}'
            except Exception as e:
                error_msg = f"{type(e).__name__}: {str(e)}"
                logger.error(f"Resource {uri} failed: {error_msg}")
                return f'{{"error": "{error_msg}"}}'

        @self.server.list_tools()
        async def list_tools() -> list[Tool]:
            return [
                Tool(
                    name="fable_start_building",
                    description="Initialize a new fable workflow builder. Returns an empty FableBuilder ready for adding blocks.",
                    inputSchema={
                        "type": "object",
                        "properties": {},
                    },
                ),
                Tool(
                    name="fable_add_block",
                    description="Add a block to the builder and get validation/expansion results. The builder should be a FableBuilder with a 'blocks' dict mapping block IDs to BlockInstance objects. Returns the updated builder and validation results including possible next blocks.",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "builder": {
                                "type": "object",
                                "description": "Current FableBuilder state with 'blocks' dict",
                                "properties": {
                                    "blocks": {
                                        "type": "object",
                                        "description": "Dictionary mapping block_id to BlockInstance objects",
                                    }
                                },
                                "required": ["blocks"],
                            },
                            "block_id": {
                                "type": "string",
                                "description": "Unique identifier for this block instance (e.g., 'source1', 'product1')",
                            },
                            "block": {
                                "type": "object",
                                "description": "BlockInstance with factory_id, configuration_values, and input_ids",
                                "properties": {
                                    "factory_id": {
                                        "type": "object",
                                        "description": "PluginBlockFactoryId with plugin and factory fields",
                                        "properties": {
                                            "plugin": {
                                                "type": "object",
                                                "description": "PluginCompositeId with store and local fields",
                                                "properties": {
                                                    "store": {"type": "string", "description": "e.g., 'ecmwf'"},
                                                    "local": {"type": "string", "description": "e.g., 'toy2'"},
                                                },
                                                "required": ["store", "local"],
                                            },
                                            "factory": {"type": "string", "description": "Factory name, e.g., 'exampleSource'"},
                                        },
                                        "required": ["plugin", "factory"],
                                    },
                                    "configuration_values": {
                                        "type": "object",
                                        "description": "Configuration values for the block",
                                        "additionalProperties": True,
                                    },
                                    "input_ids": {
                                        "type": "object",
                                        "description": "Input connections mapping input names to block IDs",
                                        "additionalProperties": {"type": "string"},
                                    },
                                },
                                "required": ["factory_id", "configuration_values", "input_ids"],
                            },
                        },
                        "required": ["builder", "block_id", "block"],
                    },
                ),
                Tool(
                    name="fable_save",
                    description="Save the builder for later use. Optionally provide a fable_id to update an existing builder, or leave blank to create new. Returns the fable ID.",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "builder": {
                                "type": "object",
                                "description": "FableBuilder to save with 'blocks' dict",
                                "properties": {
                                    "blocks": {
                                        "type": "object",
                                        "description": "Dictionary mapping block_id to BlockInstance objects",
                                    }
                                },
                                "required": ["blocks"],
                            },
                            "fable_id": {
                                "type": "string",
                                "description": "Optional: existing fable ID to update",
                            },
                            "tags": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "Optional: tags for categorizing the fable",
                            },
                        },
                        "required": ["builder"],
                    },
                ),
                Tool(
                    name="fable_load",
                    description="Load a previously saved workflow builder by its ID. Returns the FableBuilder.",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "fable_id": {
                                "type": "string",
                                "description": "The ID of the fable to load",
                            }
                        },
                        "required": ["fable_id"],
                    },
                ),
            ]

        @self.server.call_tool()
        async def call_tool(name: str, arguments: Any) -> list[TextContent]:
            try:
                if name == "fable_start_building":
                    result = {"blocks": {}}
                    return [TextContent(type="text", text=str(result))]

                elif name == "fable_add_block":
                    builder = arguments["builder"]
                    block_id = arguments["block_id"]
                    block = arguments["block"]

                    builder["blocks"][block_id] = block

                    route = "api/v1/fable/expand"
                    logger.debug(f"PUT {route}, params=None, body={builder}")
                    response = await self.client.request(url=route, method="put", json=builder)
                    response.raise_for_status()
                    result = response.json()

                    return [TextContent(type="text", text=f"Block added. Validation: {result}")]

                elif name == "fable_save":
                    builder = arguments["builder"]
                    fable_id = arguments.get("fable_id")
                    tags = arguments.get("tags", [])

                    body: dict[str, Any] = {"builder": builder, "tags": tags}
                    if fable_id:
                        body["fable_builder_id"] = fable_id

                    route = "api/v1/fable/upsert"
                    logger.debug(f"POST {route}, params=None, body={body}")
                    response = await self.client.post(route, json=body)
                    response.raise_for_status()
                    saved_id = response.json()

                    return [TextContent(type="text", text=f"Fable saved with ID: {saved_id}")]

                elif name == "fable_load":
                    fable_id = arguments["fable_id"]
                    route = "api/v1/fable/retrieve"
                    params = {"fable_builder_id": fable_id}
                    logger.debug(f"GET {route}, params={params}, body=None")
                    response = await self.client.get(route, params=params)
                    response.raise_for_status()
                    return [TextContent(type="text", text=response.text)]

                else:
                    raise ValueError(f"Unknown tool: {name}")

            except httpx.HTTPStatusError as e:
                error_msg = f"HTTP {e.response.status_code} error: {e.response.text}"
                logger.error(f"Tool {name} failed: {error_msg}")
                return [TextContent(type="text", text=f"Error: {error_msg}")]
            except Exception as e:
                error_msg = f"{type(e).__name__}: {str(e)}"
                logger.error(f"Tool {name} failed: {error_msg}")
                return [TextContent(type="text", text=f"Error: {error_msg}")]

        @self.server.list_prompts()
        async def list_prompts() -> list[Any]:
            return [
                {
                    "name": "create_simple_workflow",
                    "description": "Guide to creating a simple data processing workflow using the example source and mean product",
                    "arguments": [],
                },
                {
                    "name": "explore_catalogue",
                    "description": "Guide to exploring available blocks and understanding the fable catalogue structure",
                    "arguments": [],
                },
            ]

        @self.server.get_prompt()
        async def get_prompt(name: str, arguments: dict[str, str] | None) -> Any:
            if name == "create_simple_workflow":
                return {
                    "messages": [
                        {
                            "role": "user",
                            "content": {
                                "type": "text",
                                "text": """Let's create a simple workflow that processes weather data:

1. First, check the catalogue resource (fable://catalogue) to see available blocks
2. Start a new builder with fable_start_building
3. Add an 'exampleSource' as the data source (usually from fiab_plugin_toy)
   - Use fable_add_block with proper BlockInstance structure (factory_id, configuration_values, input_ids)
4. Add a 'meanProduct' to calculate the mean of the 2t variable
   - Connect it to the source using input_ids
5. Each add_block call returns validation results showing if the workflow is valid and what blocks can be added next
6. Save it with fable_save and appropriate tags

Remember: Use the exact server schema - factory_id (with plugin and factory), configuration_values, and input_ids.""",
                            },
                        }
                    ]
                }
            elif name == "explore_catalogue":
                return {
                    "messages": [
                        {
                            "role": "user",
                            "content": {
                                "type": "text",
                                "text": """Let's explore what blocks are available:

1. Read the fable://catalogue resource to see all available plugins
2. Look for different types of blocks:
   - 'source' blocks: provide initial data
   - 'product' blocks: transform or process data
   - 'sink' blocks: output or store results
3. Note the configuration options and inputs required for each block type

Understanding the catalogue helps you build valid workflows.""",
                            },
                        }
                    ]
                }
            else:
                raise ValueError(f"Unknown prompt: {name}")

    async def run(self) -> None:
        """Run the MCP server using stdio transport."""
        async with stdio_server() as (read_stream, write_stream):
            await self.server.run(read_stream, write_stream, self.server.create_initialization_options())
