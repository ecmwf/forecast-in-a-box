Inspect the backend/packages/fiab-plugin-test. We want to add a new sink called `sink_image`,
which takes input an int, and generates a 64x64 image, and returns it as bytes.
The integer would be interpreted as eg black white color, so take it modulo 256.
Try to do it without any external dependencies.
Note that there must be a runtime function which does this, and a corresponding BlockFactory.
Write a unit test for the runtime function.
Run unit tests and type check for this plugin, then commit.

This may break some of the integration tests in backend/ since they hardcode expectations about what
the test plugin exposes -- fix accordingly, then commit.

Then inspect the blueprint integration tests in the backend package, there is test_run_output_content.
Extend the builder to include this sink as well, using the source_42 as input, but dont delete the existing sink.
Fix the asserts on the number of sink tasks and retrieval of sink task ids.
Then add to the end of the test retrieval of this new output -- check for the value of content-type (I'm not sure
what the backend will return, go with whatever it returns) and for the length (it should be 64x64? Again trust
what the current state is, as long as its not zero).
Once `just val` passes, commit.
