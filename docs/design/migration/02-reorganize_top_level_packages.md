# 02 - reorganize top level packages

Likely files and directories to read and modify first:

- `backend/src/forecastbox/config.py`
- `backend/src/forecastbox/rjsf/`
- `backend/src/forecastbox/auth/`
- `backend/src/forecastbox/standalone/`
- `backend/src/forecastbox/entrypoint.py`
- `backend/src/forecastbox/__init__.py`
- imports across `backend/src/forecastbox/**/*.py`
- new directories under `backend/src/forecastbox/{utility,domain,routes,schemata,entrypoint}/`

## Objective

Create the target architectural skeleton and perform the agreed top-level relocations:

- `config.py` -> `utility/config.py`
- `rjsf/` -> `utility/rsjf/`
- `auth/` -> `entrypoint/auth/`
- `standalone/` -> `entrypoint/bootstrap/`

At the same time, create the empty or near-empty canonical package roots needed by later steps:

- `utility/`
- `domain/`
- `routes/`
- `schemata/`
- `entrypoint/`

## Required outcome

- the canonical package roots exist,
- the agreed relocations are complete,
- internal imports are updated to the new canonical paths,
- any temporary re-export shims are minimal and clearly transitional.

## Concrete changes

1. Create the canonical package skeleton.

At minimum:

- `forecastbox/utility/__init__.py`
- `forecastbox/domain/__init__.py`
- `forecastbox/routes/__init__.py`
- `forecastbox/schemata/__init__.py`
- `forecastbox/entrypoint/__init__.py`

2. Move config into `utility/config.py`.

This step should establish `forecastbox.utility.config` as the canonical import path. Update internal imports accordingly.

3. Move `rjsf` into `utility/rsjf/`.

This step should establish `forecastbox.utility.rsjf` as the canonical import path and preserve the existing RJSF-focused unit tests.

4. Move auth into `entrypoint/auth/`.

The auth package is treated as application boot/runtime support, not domain code. Move the current auth package under `entrypoint/auth/` and update imports accordingly.

5. Move standalone into `entrypoint/bootstrap/`.

The standalone launch and bootstrap helpers belong with entrypoint concerns, not in the domain layer.

6. Prepare `schemata/`.

Even if the ORM files are not yet fully moved, this step should create the canonical `schemata` package and establish where the ORM modules will live.

## Behavior constraints

- No route renaming yet.
- No domain extraction yet beyond package scaffolding.
- `models` and `products` should already be gone from step 01; do not reintroduce them.

## Validation

- Run `cd backend && just val`.

## Handoff notes for the next step

This step is successful when later agents can build domain/routes work on top of the new package roots and no longer need to keep `config`, `auth`, or `standalone` at the old top level.
