# Goal
Plugins can currently declare BlockFactories.
We propose extending that with higher level assets, such as blueprints or glyphs.

# User Stories
1. As a developer, I would like to put a partial graph of the block factories in the plugin, with possibly different defaults or glyphs in place, as well as the backend-owned blueprint metadata (display name, description, tags, ...), into the plugin, to demonstrate usage or provide quickstart templates.
2. As a user, I would like to use a blueprint from a plugin to build my own blueprint. This comes with aspects:
  1. I should be able to filter saved blueprints by source (mine, another user's, from a plugin -- concrete plugin).
  2. I can use the plugin's blueprint, change what I need and save as my own derived template from it; or just provide concrete execution values and run straight away.
  3. When the plugin is being updated, the previous executions or templates derived from the exported blueprints are unchanged. I can access the new blueprints, but the old ones become hidden, available only for re-run reasons.
3. As a user/admin, I can install plugins configurably:
  1. I can import only selected blueprints from plugins
  2. For the blueprints, I can change names of the glyphs used in the blueprint (with the motivation of making them match a global glyph defined in this backend)
  3. This setting is persisted, and when I update the plugin, I can revisit its application, but don't need to define it from scratch
  4. Even after installation, I can revisit and effectively "re-install" the plugin -- without breaking previous executions or templates derived from it

# Technical Details
* What fields do we open for specification for the BlueprintBuilder domain entity:
  * On `blueprint` root level include: `display_name`, `display_description`
  * On `blueprint` root level exclude: `tags` (and the remaining fields as they are clearly internal)
  * On `builder.blocks` level -- it is a dict of instanceId→instance, we include it as is, only validate at store time it can be instantiated with the plugin itself,
  * On `builder.environment` level include: `environment_variables` KV
  * On `builder.environment` level exclude: `cascade_infra` (slurm or local, etc), `hosts`, `workers_per_host`, `runtime_artifacts` (this is already derivable in compilation... not sure why we still store it)
  * On `builder.local_glyphs` level -- it is a dict, we can include it as is.
* In addition to BlueprintBuilder, the plugin will have to provide `example_values`, a double dict of BlockInstanceId, ConfigurationOptionId, and a dict of glyphs (str,str). And while the BlueprintBuilder need not to pass `validate` of the plugin, because some values may be missing (as the blueprint is intended to be partial, a template), when validated with these values in addition, it must pass. 
  * Those would additionally provide "guiding" element to the user, but are *clearly* separated from the configuration options in the builder -- the user is *expected* to override these examples
  * We could in theory make do with just the configuration options in the example values, but that would put extra burden on plugin developers, and make it less intelligible
* Install of plugin will need to become stateful with dedicated persistence, from the current 'pip install and import'
  * We will store like a map of excluded plugin, and a map of glyphName renames
  * The act of installing will inspect the loaded module, and insert the blueprints locally
  * This happens every time the user updates the installation instructions (exclusions or mappings) or the plugin itself is updated
    * We will set `source` plugin_template to make it visible to all users, and `created_by` to be the name of the plugin, to make it immutable by the users
    * We will treat the `display_name` as the "key" for update-or-insert, and as the "key" for the excluding. Hence if user has changed the exclusion list, we will search if there is any blueprint with this name created by this plugin, and set is_deleted=True. And for the non-excluded, inserted, we will generate a new blueprint id only if there is no such display name yet, otherwise reuse it and increase the blueprint id

# Suggested implementation path
1. Preparation on fiab-core:
  * Extension of the fiab-core package with the BlueprintTemplate entity
  * Example thereof in the fiab-plugin-test
  * Minimalistic unit tests only in these two respective wheels, no integration tests
2. First phase of backend:
  * DB Table for plugin settings and its usage in the current install lifecycle (insert default values (no overrides) + version + date on first install, update version/date on updates)
    * No inserts of templates yet
    * Also include 'error' column -- this needs to be aligned with the state of plugin manager. Install errors go to db, import errors go to in-memory state, and the status endpoint should synthesize
    * Note that the install must be 'atomic' -- we dont want two installs of the same plugin happen at the same time. There will need to be locks, because the install process will potentially take time, and could be triggered by the user multiple times concurrently
  * Minimalistic unit tests for this with mocks
  * Integration tests should verify that test plugin install is correctly reported
3. Backend processes plugin blueprints
  * Implement the logic of reading blueprints from the plugin and upserting into the db
  * Ignore the exclusion and remapping of glyphs, and ignore validation
  * Integration tests should verify the plugin's blueprint is present in the list route
4. Add backend route for plugin settings update: of glyph remapping and of exclusion (single route with Request object that has both optional)
  * Update the logic of plugin blueprint upserts to respect exclusion; ignore the glyph remapping for now
  * Add an integration test that calls this route and marks one blueprint as excluded, and then verifies it is not in the list call (the test plugin should contain one 'testExclusion' blueprint which will not be used elsewhere)
5. Implement the glyph remapping function -- note it is a "regexp"-style remapping, ie, we will not like resolve glyphs recursively etc
  * The low level "remap glyphs in string" should probably be in domain/glyphs
  * The high level "remap glyphs in builder" should probably be in domain/blueprint, and just calls the low level function on each configuration option value as well as local glyph value, and renames the key if present in local glyphs
  * The plugin manager then calls this function if there is any remapping defined in the plugin settings prior to the db insert
  * The integration test that already calls this route for testing the exclusion will additionally set remapping for another blueprint (again, unique for this, 'testRemapping blueprint) and verify the list returns it
6. Implement the blueprint validation -- after the exclusion and remapping, the plugin manager should call the existing validate_expand(validate_only=True) function, but first calling a 'resolve_builder_with_examples(builder, config_options, local_glyph_values)', newly implemented in domain/blueprint. On failure, this blueprint is not inserted, and all such errors are collected and inserted into the db
  * The integration test that verifies that test plugin install is correctly reported will now verify that a particular blueprint in the plugin ('testFailValidation' is correctly reported as failed)
