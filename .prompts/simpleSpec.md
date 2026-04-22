---
name: Implement Simple Specification
parameters:
  - spec_file
---
Act as a senior software developer. 

1. Read the specification at docs/developer/changeSpecs/{{spec_file}}.
2. Implement the required change.
3. If you encounter substantial issues, or if you consider the spec incomplete, or if it appears the spec author did not think it through correctly -- do not try to be overly smart. Instead, stop and ask for clarification.
4. After `just val` passes, make sure you are not in the `main` branch, and make one or more commits, each comprising a standalone part of the spec. Do not push.
