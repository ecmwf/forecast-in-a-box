import logging

from common import LOGGER_NAME, configure_logging, make_client, wait_for_backend_ready

logger = logging.getLogger(LOGGER_NAME)

if __name__ == "__main__":
    # Standalone readiness check, used by scripts/start_backend.sh right after backgrounding the
    # backend process: `uvx --with httpx python common.py`
    configure_logging()
    with make_client() as _client:
        logger.info(f"waiting for backend at {_client.base_url} to become ready...")
        wait_for_backend_ready(_client)
        logger.info("backend is ready")
