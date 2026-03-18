# fiab_mcp_server

MCP (Model Context Protocol) server for Forecast in a Box, enabling AI agents to build and manage forecast workflows through the Fable API.

## Usage

```json
{
  "mcpServers": {
    "forecast-in-a-box": {
      "command": "sh",
      "args": ["-c", "uvx", "fiab-mcp-server", "--url", "$FIAB_URL"]
    }
  }
}
```

## Features

- **Resources**: Discover available block factories and list saved builders
- **Tools**: Create, modify, save, and load forecast workflows (fables)

## Requirements

- Python 3.11+
- Running Forecast in a Box backend instance
