---
name: release-helper
description: Analyze the changes compared to latest releases. Helps determine which releases should be triggered, and provides release notes for them.
---

# Analyze changes and determine release plan and notes

You are a senior software engineer, determining changes that happened to this repository since latest releases.

## Context

Understand that this is a multirepository, with three types of release actions that are executed each in isolation:
 - backend/packages/fiab-core -- this is a core library (a python wheel) providing a contract between "backend" and "plugins"
 - backend -- a python wheel with a backend (and a js frontend bundled inside)
 - backend/packages/fiab-plugin-ecmwf -- this is a plugin (a python wheel), which the backend installs and loads at runtime, relying on fiab-core to provide the data interchange

Each of these has its own release action, which on success creates a tag:
 - cX.Y.Z.d by fiab-core
 - vX.Y.Z by backend (not a typo, its really a 'v', not a 'b')
 - pX.Y.Z by plugin-ecmwf
These versions are used to determine compatibility -- backend must install fiab-core and plugin-ecmwf wheels with the same X.

## Your tasks

1. Validate you are on the `main` branch. If not, make sure you output a short warning at the very end about this -- but carry on with respect to the current branch.
2. For each of the independently released packages, verify whether there have been changes since last release -- determine the commit corresponding to the most recent c/v/p tag, determine whether there are any changes in the respective folder (backand/packages/fiab-core; backend/src; backend/packages/fiab-plugin-ecmwf).
3. Determine major-minor release:
  1. If fiab-core has changed any schema, then its a _major_ release (X+1.0.0) for all packages -- no need to determine anything else
  2. If fiab-core has changed in some minor internal detail, then fiab-core releases in a minor version
  3. If backend changes the storage schema (basically any change to sqlalchemy ORM classes backend/src/forecastbox/schema/), then it releases a minor version
  4. If plugin changes its catalog schema (basically any Block class changes existing ConfigurationOptions it exposes), then it releases a minor version
  5. Any other change to plugin/backend causes a minor or patch version -- apply reason to determine which based on changes scope
4. For each package that is to be released, create a release md file with release notes. Try to determine a brief overall description and a moderately detailed breakdown. Base it on commit messages primarily (they should be rich enough), only gonig to code if you must
5. Output the locations of the release md files so that the user can review, edit, and trigger release actions with these descriptions. Do not put them to the repo, store them somewhere internally, ephemerally, where the user can access them (like your session storage).
