"""
Contains code for the controller server:
 - receives commands from the `frontend` to submit new jobs or retrieve results of existing ones,
 - receives registrations from `worker` processes and updates about their states,
as well as controller client -- the component that sends commands and updates to `worker`s to launch jobs or send data
"""
