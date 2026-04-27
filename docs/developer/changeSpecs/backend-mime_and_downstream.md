# Goal
Propose output type / mime type contract offered by the backend.
Propose how integration with downstream postprocessors and tools like SkinnyWMS would be utilized.

# MIME type
A block instance can currently output multiple types: qubed, raw, none; possibly expanding in the future.
The raw type can hold images like png, or documents like pdf.
To determine the underlying type, we currently need to deserialize the raw bytes at the backend, and look up based on class or type what the correct mime type should be.

**Proposal**: extend the Raw type with optional MIME type string field, and set it at the fable compile time.
1. *Assumption*: we don't expect qubed or future possible types to be ever interpretable by the browser, or if they are, their MIME type to be static.
2. *Assumption*: we expect MIME type to be determinable at the compile time, ie, without access to the runtime.
3. *Assumption*: Raw type would have a single field, but the underlying fluent action / cascade subgraph can produce multiple outputs (either via a generator cascade node, or by being a static subgraph). All these outputs would be of the same MIME type.

# SkinnyWMS
For start, we can create a new domain/route set, like Downstream or PostprocessingTools or DisplayTools or Lenses.
SkinnyWMS would be a first such, with routes like `start(location) -> handle(pid, port)`, `list()`, `kill(pid)`, `status(pid)`, etc.
However, the question is how to go from "a job produced data at folder F" to "skinnyWMS has been launched at folder F":
1. *Option*: the user does it manually -- the job outputs the location as RawOutput with mime type text, the user copies it and invokes the standalone `start` api call manually.
2. *Option*: the frontend does it -- we would use a mime type such as "text/plain;gribFilePath", the backend would expose a static API (mimeParameter -> [tools]), thus the frontend would know that for this mime type it can invoke the skinnyWMS tool, and would offer so in the UI in that output's detail
3. *Option*: the backend does it -- similarly how we do expands to add blocks, we would "expand" sinks for postprocessing via backend API, and the blueprint in question would persist this information and return the skinnyWMS port as one of its outputs

The options 2 and 3 are not different from the PoV of the tools or plugins -- either way the correct mime type must be set in advanced in the plugin and thus the set of supported types must be fixed in fiab-core, and we must have a `type->tool` lookup in the backend.
But they differ in terms of blueprint persistence and reusability, such as:
* When I submit the job, do I know in advance which postprocessing tools to launch?
* When I re-launch my job or re-use it to build another job, do I want the same set of tools to be launched afterwards?

Note that the options are _not_ exclusive -- the first one can't be prevented, and we can allow both in-advance and post-hoc launch.
However, this may muddy the "what happens if I re-launch the job" question -- some of the post-proc tools would get re-launched, others won't.
Lastly, the Option 2 actually also allows in-advance specification -- the frontend has access to the output type at compile time too, so it can offer the user to launch a tool _but_ remember it itself, not persist it in the backend.
In other words, the frontend can offer "output preview" at the job building time, with the option to specify "completion hooks".
But we must be careful to not reinvent a "second order compute graph" with postprocessing here -- thus the vanilla option 2 may be a reasonable start.
