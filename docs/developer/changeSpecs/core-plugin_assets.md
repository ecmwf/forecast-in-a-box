# Goal
Plugins can currently declare BlockFactories.
We propose extending that with higher level assets, such as blueprints or glyphs.

# User Stories
1. As a developer, I would like to put a partial graph of the block factories in the plugin, with possibly different defaults or glyphs in place, as well as the backend-owned blueprint metadata (display name, description, tags, ...), into the plugin, to demonstrate usage or provide quickstart templates.
2. As a user, I would like to use a blueprint from a plugin to build my own blueprint. This comes with aspects:
  1. I should be able to filter saved blueprints by source (mine, another user's, from a plugin -- concrete plugin).
  2. I can use the plugin's blueprint, change what I need and save as my own derived template from it; or just provide concrete execution values and run straight away.
  3. When the plugin is being updated, the previous executions or templates derived from the exported blueprints are unchanged. I can access the new blueprints, but the old ones become hidden, available only for re-run reasons.

# Open Questions
* What fields do we open for specification?
  * On `blueprint` root level include: `display_name`, `display_description`
  * On `blueprint` root level exclude: `tags` (and some more clearly internal fields)
  * On `builder.blocks` level -- it is a dict of instanceId→instance, we include it as is, only validate at store time it can be instantiated with the plugin itself,
  * On `builder.environment` level include: `environment_variables` KV (_note_: we should probably purge them from the storage itself, in favour of compilation being able to provide them) 
  * On `builder.environment` level exclude: `cascade_infra` (slurm or local, etc), `hosts`, `workers_per_host`, `runtime_artifacts` (this is already derivable in compilation... not sure why we still store it)
  * On `builder.local_glyphs` level -- it is a dict, we can include it as is.
    * **TODO**: would we support a _mapping_ of the glyphs in some fashion? Say the blueprint includes a `storage_root` local glyph but the installation has a `root_storage` global glyph. Could we "install with glyph rename"? The user can do it manually, but: a/ it's quite a chore, defeating the purpose of the glyphs b/ the renamed blueprint will remain after update, requiring manual delete c/ the newly installed blueprints would have to be renamed as well. We _could_ make the plugin installation a more involved process, where you could inspect and override first, and this would be persisted across updates. That is powerful, but the first run becomes a bit more hassle
* What validation do we want in place?
  * Either, the plugins will provide only _fully-fledged_ blueprints, meaning every block has a valid configuration with all variables filled. This however forces usage of placeholders, making it unclear to the user what they are expected to override and what not.
  * Or, we don't run the plugin's `validate` at all, allowing for saving partial or even broken blueprints.
  * Or, we mandate that every configuration option in the builder has a static value or a local glyph, _and_ the plugin would for every blueprint provide "examples" which would be `dict: [localGlyph, str]`, which would then be used for the `validate` call.
    * This could stay hidden from the user, or we could introduce a new endpoint/UX for this.
* Do we want to allow global glyphs? Does not seem to accompany any user story, and would introduce a new kind of conflicts.

# Technical Details
* Install of a plugin currently consists of pip installing, and then trying to load -- and is rather stateless, we don't mark an installation being succesful, ie, we "install" on every start and rely on the venv to persist the state. We will need to introduce a backend-owned state, and extend the process by loading the assets after the install, and then marking a success. Subsequent installs will only consolidate, based on consultation of this state.
* This state will include the user triggering the install of the plugin, so that `created_by` field can be filled in the saved blueprints. On passthrough installs, we will use the default user.
  * **TODO**: Unclear how to handle initially configured plugins in the non-passthrough installs. But if the install became "configurable", this gets solved
* If a blueprint has `source=plugin_template`, then we will put to tags the name and version of the plugin
* Update of a plugin will mark all previously sourced blueprints as `is_deleted`
