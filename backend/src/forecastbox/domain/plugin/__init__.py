"""
Manages Plugin domain -- python packages (wheels) that expose a concrete interface used for Blueprint
building and validation, and Run execution.

Depends on no other domain.
Depended on by Blueprint and Run domains -- they need to extract individual plugin validations and compilers.
"""
