Implement an MCP server skeleton. We want:
 - a new package, in `backend/packages/fiab_mcp_server`
 - for now don't add any dependencies between it and other packages here
 - the main entrypoint would accept `--url` argument where the fiab backend would be running
 - the expected usage in an agent config is 
```
"mcpServers": {
    "forecast-in-a-box": {
        "command": "sh",
        "args": ["-c", "uvx", "fiab_mcp_server", "--url", "$FIAB_URL"]
    }
}
```

Inspect primarily the backend/src/forecastbox/api/routers/fable.py -- this is what we'll expose in the MCP server.
We want the agent to be able to do things like showcased in the backend/tests/nonpytest/fable.py.

In detail, we want something like:
Resources
```
- fable://catalogue → Discover available block factories
- fable://builders → List saved builders
```

Tools
```
- fable_start_building() → Builder, "Initialize a new fable workflow"
- fable_add_block(builder, block, config, inputs) → ValidationResult, "Add a block to the builder, returns validation and expansion options"
- fable_save(builder, fable_id, tags) → FableId "Save the builder for later use"
- fable_load(fable_id) → Builder "Load a previously saved workflow"
```

For now, ignore execution and authentication -- that is, assume the backend is started in no-auth regime, and that we are happy with the agent just building and saving the workflow, not actually executing it.

Regarding prompts -- ideate one or two if it makes sense and put them there.

Ignore writing any tests, just put there a dummy test_ok.py file.
