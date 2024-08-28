"""
A lightweight wrapper to accompany a job from `jobs` and to interact with `controller`.
The wrapper will start a server to listen to `controller`s requests and have a client to send data the other way.

Primary function is to receive a command to start a particular `job` via spawning a new process from the wrapper,
and then monitoring the process / retrieving its results.
"""
