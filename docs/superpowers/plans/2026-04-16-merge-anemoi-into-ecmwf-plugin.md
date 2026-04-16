# Merge fiab-plugin-anemoi into fiab-plugin-ecmwf Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all Anemoi block functionality from `fiab-plugin-anemoi` into `fiab-plugin-ecmwf` as an `anemoi/` subpackage, then delete the now-redundant package.

**Architecture:** An `anemoi/` subpackage is added to `fiab_plugin_ecmwf`, containing the moved `blocks.py` and `utils.py` verbatim. The main `fiab_plugin_ecmwf/__init__.py` registers all six blocks (including the two Anemoi ones) under the existing `ecmwf-base` plugin. `fiab-plugin-anemoi` is removed from the workspace and deleted.

**Tech Stack:** Python, uv workspace, setuptools-scm, pytest

---

## File Map

| Action | Path |
|--------|------|
| Create | `backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/anemoi/__init__.py` |
| Create | `backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/anemoi/blocks.py` |
| Create | `backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/anemoi/utils.py` |
| Modify | `backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/__init__.py` |
| Modify | `backend/packages/fiab-plugin-ecmwf/pyproject.toml` |
| Modify | `backend/pyproject.toml` |
| Modify | `install/plugins.json` |
| Delete | `backend/packages/fiab-plugin-anemoi/` (entire directory) |

---

### Task 1: Create the `anemoi/` subpackage in fiab-plugin-ecmwf

**Files:**
- Create: `backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/anemoi/__init__.py`
- Create: `backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/anemoi/utils.py`
- Create: `backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/anemoi/blocks.py`

- [ ] **Step 1: Create the package marker**

Create `backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/anemoi/__init__.py` with contents:

```python
# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.
```

- [ ] **Step 2: Create `anemoi/utils.py`**

Create `backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/anemoi/utils.py` with contents:

```python
# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

import importlib.metadata
import re
from pathlib import Path
from typing import cast

from anemoi.inference.metadata import Metadata as InferenceMetadata
from anemoi.inference.metadata import MetadataFactory as InferenceMetadataFactory
from cascade.low.func import Either
from earthkit.workflows.plugins.anemoi.utils import expansion_qube
from fiab_core.artifacts import ArtifactsProvider, CheckpointLookup, CompositeArtifactId
from fiab_core.fable import BlockInstance
from fiab_core.plugin import Error
from fiab_plugin_ecmwf.metadata import QubedInstanceOutput

ENVIRONMENT_PACKAGES: list[str] = [
    "anemoi.models",
    "torch",
    "torch_geometric",
]

all_checkpoints: CheckpointLookup = ArtifactsProvider.get_checkpoint_lookup()
AVAILABLE_CHECKPOINTS: CheckpointLookup = {
    composite_id: checkpoint
    for composite_id, checkpoint in all_checkpoints.items()
    # TODO: Add filtering here
}
CHECKPOINT_ENUM_TYPE = f"enum['{', '.join(CompositeArtifactId.to_str(k) for k in AVAILABLE_CHECKPOINTS.keys())}']"


def get_local_path(composite_id: CompositeArtifactId) -> Path:
    return Path(ArtifactsProvider.get_artifact_local_path(composite_id))


def get_metadata(composite_id: CompositeArtifactId) -> InferenceMetadata:
    checkpoint = AVAILABLE_CHECKPOINTS[composite_id]
    return cast(InferenceMetadata, InferenceMetadataFactory(checkpoint.metadata))


INPUT_SOURCE_EXTRAS: dict[str, str] = {
    "opendata": "anemoi-plugins-ecmwf-inference[opendata]",
    "polytope": "anemoi-plugins-ecmwf-inference[polytope]",
    "mars": "earthkit-data[mars]",
}


def get_environment(composite_id: CompositeArtifactId, input_source: str | None = None) -> list[str]:
    metadata = get_metadata(composite_id)
    training_env = metadata.provenance_training()["module_versions"]

    matched_packages = set()
    for package in ENVIRONMENT_PACKAGES:
        matched_packages.update(re.findall(package, " ".join(training_env.keys())))

    environment = {pkg: training_env[pkg] for pkg in matched_packages}
    # Handle recent utils change where version is now a dict with version
    environment = {key: val if not isinstance(val, dict) else val["version"] for key, val in environment.items()}
    packages = list(f"{key.replace('.', '-')}=={val.split('+')[0]}" for key, val in environment.items())

    if input_source in INPUT_SOURCE_EXTRAS:
        packages.append(INPUT_SOURCE_EXTRAS[input_source])

    packages.append(f"earthkit-workflows-anemoi[runtime]=={importlib.metadata.version('earthkit-workflows-anemoi')}")
    return packages


def validate_anemoi_block(block: BlockInstance) -> Either[QubedInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
    """Validate common Anemoi block configuration, returning the base QubedInstanceOutput on success."""
    if not isinstance(block.configuration_values["checkpoint"], str):
        return Either.error("Checkpoint must be given")

    if not block.configuration_values["lead_time"].isdigit() or int(block.configuration_values["lead_time"]) < 0:  # type: ignore
        return Either.error("Lead time must be an int and non-negative")

    ensemble_members = block.configuration_values.get("ensemble_members")
    if ensemble_members is not None and (not ensemble_members.isdigit() or int(ensemble_members) < 1):  # type: ignore
        return Either.error("Ensemble members must be an int and positive")

    metadata = get_metadata(CompositeArtifactId.from_str(block.configuration_values["checkpoint"]))
    qube = expansion_qube(metadata, block.configuration_values["lead_time"])
    return Either.ok(QubedInstanceOutput(dataqube=qube))
```

- [ ] **Step 3: Create `anemoi/blocks.py`**

Create `backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/anemoi/blocks.py` with contents:

```python
# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.


from typing import cast

from cascade.low.func import Either
from earthkit.workflows.fluent import Action
from earthkit.workflows.plugins.anemoi.fluent import from_initial_conditions, from_input
from fiab_core.artifacts import CompositeArtifactId
from fiab_core.fable import (
    ActionLookup,
    BlockConfigurationOption,
    BlockInstance,
    BlockInstanceId,
    BlockInstanceOutput,
)
from fiab_core.plugin import Error
from fiab_core.tools.blocks import Source, Transform
from fiab_plugin_ecmwf.metadata import QubedInstanceOutput

from .utils import (
    CHECKPOINT_ENUM_TYPE,
    get_environment,
    get_local_path,
    validate_anemoi_block,
)


class AnemoiSource(Source):
    title: str = "Anemoi Model Source"
    description: str = "Get a forecast from an Anemoi checkpoint, initialised from a source."
    configuration_options: dict[str, BlockConfigurationOption] = {
        "checkpoint": BlockConfigurationOption(
            title="Anemoi Checkpoint",
            description="Anemoi checkpoint name",
            value_type=CHECKPOINT_ENUM_TYPE,
        ),
        "input_source": BlockConfigurationOption(
            title="Input Source",
            description="Source of the initial conditions",
            value_type="enum['mars', 'opendata', 'polytope']",
        ),
        "lead_time": BlockConfigurationOption(
            title="Lead time",
            description="Lead time of the forecast",
            value_type="int",
        ),
        "base_time": BlockConfigurationOption(
            title="Base time",
            description="Base time of the forecast",
            value_type="datetime",
        ),
        "ensemble_members": BlockConfigurationOption(
            title="Ensemble Members",
            description="Number of ensemble members, default is 1.",
            value_type="optional[int]",
        ),
        "configuration": BlockConfigurationOption(
            title="Anemoi Configuration",
            description="Extra Anemoi configuration parameters",
            value_type="optional[dict]",
        ),
    }
    inputs: list[str] = []

    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[QubedInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        result = validate_anemoi_block(block)
        if result.e or not result.t:
            return result

        ensemble_members = block.configuration_values["ensemble_members"]
        qubed_instance = result.t.expand({"number": range(1, (int(ensemble_members) or 1) + 1)})
        return Either.ok(qubed_instance)

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        configuration = block.configuration_values
        composite_id = CompositeArtifactId.from_str(configuration["checkpoint"])
        action = from_input(
            get_local_path(composite_id),
            configuration["input_source"],
            lead_time=configuration["lead_time"],
            date=configuration["base_time"],
            ensemble_members=cast(int, configuration["ensemble_members"]) if configuration["ensemble_members"] is not None else None,
            environment=get_environment(composite_id, configuration["input_source"]),
        )
        return Either.ok(action)


class AnemoiTransform(Transform):
    title: str = "Anemoi Model Transform"
    description: str = "Initialise an Anemoi model from a source"
    configuration_options: dict[str, BlockConfigurationOption] = {
        "checkpoint": BlockConfigurationOption(
            title="Anemoi Checkpoint",
            description="Anemoi checkpoint name",
            value_type=CHECKPOINT_ENUM_TYPE,
        ),
        "lead_time": BlockConfigurationOption(
            title="Lead time",
            description="Lead time of the forecast",
            value_type="int",
        ),
        "configuration": BlockConfigurationOption(
            title="Anemoi Configuration",
            description="Extra Anemoi configuration parameters",
            value_type="optional[dict]",
        ),
    }
    inputs: list[str] = ["dataset"]

    def validate(self, block: BlockInstance, inputs: dict[str, BlockInstanceOutput]) -> Either[BlockInstanceOutput, Error]:  # type:ignore[invalid-argument] # semigroup
        result = validate_anemoi_block(block)
        if result.e or not result.t:
            return result  # type: ignore

        qubed_instance = result.t
        input_dataset = cast(QubedInstanceOutput, inputs["dataset"])
        if "number" in input_dataset:
            qubed_instance = qubed_instance.expand({"number": input_dataset.axes()["number"]})
        return Either.ok(qubed_instance)

    def compile(
        self,
        inputs: ActionLookup,
        block_id: BlockInstanceId,
        block: BlockInstance,
    ) -> Either[Action, Error]:  # type:ignore[invalid-argument] # semigroup
        input_task = block.input_ids["dataset"]
        composite_id = CompositeArtifactId.from_str(block.configuration_values["checkpoint"])
        action = from_initial_conditions(
            ckpt=get_local_path(composite_id),
            initial_conditions=inputs[input_task],
            lead_time=block.configuration_values["lead_time"],
            environment=get_environment(composite_id),
        )
        return Either.ok(action)

    def intersect(self, input: BlockInstanceOutput) -> bool:
        if not isinstance(input, QubedInstanceOutput) or input.is_empty():
            return False
        return True
```

- [ ] **Step 4: Commit**

```bash
cd backend/packages/fiab-plugin-ecmwf
git add src/fiab_plugin_ecmwf/anemoi/
git commit -m "feat: add anemoi subpackage to fiab-plugin-ecmwf"
```

---

### Task 2: Register Anemoi blocks in fiab-plugin-ecmwf's plugin

**Files:**
- Modify: `backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/__init__.py`

- [ ] **Step 1: Update `__init__.py`**

Replace the full contents of `backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/__init__.py` with:

```python
# (C) Copyright 2026- ECMWF.
#
# This software is licensed under the terms of the Apache Licence Version 2.0
# which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
#
# In applying this licence, ECMWF does not waive the privileges and immunities
# granted to it by virtue of its status as an intergovernmental organisation
# nor does it submit to any jurisdiction.

from fiab_core.tools.blocks import BlockBuilder
from fiab_core.tools.plugins import PluginBuilder

from fiab_plugin_ecmwf.anemoi.blocks import AnemoiSource, AnemoiTransform
from fiab_plugin_ecmwf.blocks import EkdSource, EnsembleStatistics, TemporalStatistics, ZarrSink

blocks: dict[str, BlockBuilder] = {
    "ekdSource": EkdSource(),
    "ensembleStatistics": EnsembleStatistics(),
    "temporalStatistics": TemporalStatistics(),
    "zarrSink": ZarrSink(),
    "anemoiSource": AnemoiSource(),
    "anemoiTransform": AnemoiTransform(),
}

plugin = PluginBuilder(block_builders=blocks).as_plugin()
```

- [ ] **Step 2: Run the existing ecmwf plugin tests to confirm nothing broke**

```bash
cd backend
uv run pytest packages/fiab-plugin-ecmwf/tests/ -v
```

Expected: all tests pass (same count as before).

- [ ] **Step 3: Commit**

```bash
git add backend/packages/fiab-plugin-ecmwf/src/fiab_plugin_ecmwf/__init__.py
git commit -m "feat: register anemoi blocks in ecmwf plugin"
```

---

### Task 3: Add Anemoi optional extras to fiab-plugin-ecmwf

**Files:**
- Modify: `backend/packages/fiab-plugin-ecmwf/pyproject.toml`

- [ ] **Step 1: Add optional extras**

In `backend/packages/fiab-plugin-ecmwf/pyproject.toml`, add two new optional dependency groups under `[project.optional-dependencies]`. The file currently has a `runtime` extra -- add alongside it:

```toml
[project.optional-dependencies]
runtime = [
    "earthkit-data>=0.18.2",
    "earthkit>=0.13.2",
]
anemoi = [
    "earthkit-workflows-anemoi>=0.4.0",
]
anemoi-runtime = [
    "anemoi-inference>=0.10.0",
]
```

- [ ] **Step 2: Commit**

```bash
git add backend/packages/fiab-plugin-ecmwf/pyproject.toml
git commit -m "feat: add anemoi optional extras to fiab-plugin-ecmwf"
```

---

### Task 4: Update the backend workspace

**Files:**
- Modify: `backend/pyproject.toml`

- [ ] **Step 1: Remove fiab-plugin-anemoi from workspace members**

In `backend/pyproject.toml`, remove `"packages/fiab-plugin-anemoi"` from `[tool.uv.workspace].members`:

```toml
[tool.uv.workspace]
members = [
    "packages/fiab-core",
    "packages/fiab-mcp-server",
    "packages/fiab-plugin-ecmwf",
    "packages/fiab-plugin-test",
]
```

- [ ] **Step 2: Remove fiab-plugin-anemoi from uv sources**

In `backend/pyproject.toml`, remove the `fiab-plugin-anemoi` line from `[tool.uv.sources]`:

```toml
[tool.uv.sources]
# TODO remove pproc and ekw-pproc once released
pproc = { git = "https://github.com/ecmwf/pproc" }
earthkit-workflows-pproc = { git = "https://github.com/ecmwf/earthkit-workflows-pproc" }
fiab-core = {workspace = true}
fiab-mcp-server = {workspace = true}
fiab-plugin-ecmwf = {workspace = true}
```

- [ ] **Step 3: Update dev dependency group**

In `backend/pyproject.toml`, replace `fiab-plugin-anemoi[runtime]` with `fiab-plugin-ecmwf[anemoi,anemoi-runtime]` in `[dependency-groups.dev]`. The full dev group should read:

```toml
[dependency-groups]
dev = [
  "pytest",
  "pytest-subtests",
  "pytest-asyncio",
  "pytest-xdist>=3.8",
  "pytest-mock>=3.15.1",
  "ty==0.0.2",
  "prek",
  "fiab-plugin-ecmwf[runtime,anemoi,anemoi-runtime]", # TODO remove after first publish
  "ruff>=0.15.8",
]
```

- [ ] **Step 4: Commit**

```bash
git add backend/pyproject.toml
git commit -m "chore: remove fiab-plugin-anemoi from workspace"
```

---

### Task 5: Remove the ecmwf-anemoi entry from plugins.json

**Files:**
- Modify: `install/plugins.json`

- [ ] **Step 1: Remove the `ecmwf-anemoi` plugin entry**

Replace the full contents of `install/plugins.json` with:

```json
{
    "display_name": "ECMWF Plugin Store",
    "plugins": {
        "ecmwf-base": {
            "pip_source": "fiab-plugin-ecmwf",
            "module_name": "fiab_plugin_ecmwf",
            "display_title": "ECMWF Plugin",
            "display_description": "ECMWF plugin for Earthkit-data sources and products",
            "display_author": "ECMWF"
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add install/plugins.json
git commit -m "chore: remove ecmwf-anemoi plugin entry, blocks now part of ecmwf-base"
```

---

### Task 6: Delete fiab-plugin-anemoi

**Files:**
- Delete: `backend/packages/fiab-plugin-anemoi/` (entire directory)

- [ ] **Step 1: Delete the package directory**

```bash
rm -rf backend/packages/fiab-plugin-anemoi
```

- [ ] **Step 2: Confirm it is gone**

```bash
ls backend/packages/
```

Expected output does not contain `fiab-plugin-anemoi`.

- [ ] **Step 3: Run the full ecmwf plugin test suite one final time**

```bash
cd backend
uv run pytest packages/fiab-plugin-ecmwf/tests/ -v
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete fiab-plugin-anemoi package"
```
