# Summary
For concurrently used structures with low write and high read volume (plugin catalogs, artifact download progresses),
utilize a pyrsistent data structure (PMap, PSet), and a threading.Lock. Reads can be done without locking, and writes
are handled by lock-protected swap:
```
new_structure = modify(the_class.the_structure)
with timed_acquire(the_class.the_lock, timeout) as lock:
  if not lock:
    raise ValueError("failed to lock")
  the_class.the_structure = new_structure
```

# Spec for Agent to Implement the Change
Currently, the code has a lot of lock-protected data structures: plugin store, plugin manager, artifacts manager.
We need to read these structures much more often than write to them, but:
 - we are not aware of a RW lock in standard python,
 - but we don't actually want to block writing anyway if there is ongoing read,
 - but we can't blindly use the structure on read without lock, because in python if collection mutates mid-iteration it raises.

So we originally choose a bad compromise of sometimes locking on read, other times hoping we won't hit a race.

A better solution is to use pyrsistent immutable data structures:
 - the slight performance penalty should not matter,
 - reads are safe because the structures are immutable,
 - writes are creating a (shallow) copy of the structure, and we only need to lock-protect the top level swap of the whole structure pointer.
