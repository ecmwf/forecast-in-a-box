Look at the backend/ in this repo, in particular the `domain.glyphs` submodule.
It contains means of storing and retrieving custom glyphs, that is, key=values used in submitted workflows.
These are exposed as http route in the `routes.blueprint` submodule.

There is a downside -- the name (key) of the glyph is a unique constraint in a database.
So when one user creates a glyph with name N, all other users are forbidden to create their own glyph of that name, including the admin.

Therefore, we would like to change the database so that the combination of user + key is the unique constraint.
However, this needs to affect resolution in some sense -- because admins can create `public` glyphs, which are available to all users.
So there may be conflict later down the road -- and in some cases we want the admin glyph to win, in other cases the user glyph.
Thus we need to extend the glyph creation route and persistence with another optional boolean flag, overriddable.
The logic is that if public=False, this flag must not be specified, and if public=True, then it must be specified.
When resolving the glyph values, the order is: (public-overriddable < users < public-nonoverriddable).

The user is free to save an overiddable glyph, it just wont be used (until the admin changes the setting).
