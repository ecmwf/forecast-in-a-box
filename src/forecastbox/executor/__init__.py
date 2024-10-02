"""
Implementation of cascade's executor

Architecture:
  - shmdb is for holding the shared memory with data required across tasks
  - entrypoint is the wrapper for executing ExecutableTaskInstance with various contexts
  - procwatch is spawning and watching processes running the tasks (using entrypoint)
  - executor is the straightforward implementation of the cascade protocol,
    offloading most work on shmdb/procwatch
  - ctrlmngr is managing controller-executor instances -- we have one for each job
  - futures is primarily a serde module which ensures all components can comm reliably
  - we re-use frontend's server for creating JobInstances, passing to ctrlmngr and displaying results
"""
