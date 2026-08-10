# Plugin Integration Tests

Status: Work-in-Progress, do *NOT* implement

There ain't much! We don't enable/disable, we don't install, we don't uninstall...

## Candidate Suggestion (ripped from an unrelated plan)
Create controlled temporary virtual environments and build tiny local wheels for at least these scenarios:

1. A plugin with a new dependency installs successfully without changing existing packages.
2. A plugin requiring a different version of an existing package fails during dry-run and leaves that package unchanged.
3. Updating the selected plugin is allowed while another installed plugin remains pinned.
4. An editable/local protected package is preserved and is not replaced from an index.
5. An editable/local selected plugin can be updated.
6. A successful real installation passes `uv pip check` and can be imported after cache invalidation.

Do not make integration tests depend on mutable public PyPI state. Use local wheels and `--find-links` or the repository's existing package-test infrastructure.
