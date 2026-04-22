"""
Manages the Glyph domain -- a Glyph is a Key-Value combination, such that the
user can use the Key across all their Blueprints, and these are then replaced
by the Value at runtime when executing a Run. This facilitates value reusal.

Depends on no other domain.
Depended on by Blueprint, Experiment, and Run (each of them needs to resolve Glyphs).
"""
