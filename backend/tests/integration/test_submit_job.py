import httpx
import pytest


def test_gateway_restart_with_in_progress_job(backend_client_with_auth: httpx.Client) -> None:
    pytest.skip("not yet supported")
    # This test requires a blueprint block that runs for several seconds (a "sleeper"),
    # so that the gateway can be killed while the job is still active.
    # The test plugin does not currently provide such a block.
    #
    # Once a sleeper block is added to fiab-plugin-test, the test should:
    #  1. Build and save a blueprint whose sink runs the sleeper block.
    #  2. POST /run/create to start a run and wait until its status is "running".
    #  3. POST /gateway/kill to terminate the gateway process.
    #  4. GET /run/get — expect status "unknown", error "failed to communicate with gateway".
    #  5. POST /gateway/start to bring the gateway back up.
    #  6. GET /run/get — expect status "failed", error "evicted from gateway".
    #
    # Scenarios already migrated to test_blueprint.py:
    #  - run delete:          test_run_delete_ok, test_run_delete_not_found,
    #                         test_run_delete_attempt_conflict
    #  - output content:      test_run_output_content
    #  - restart conflict:    test_run_restart_attempt_conflict
