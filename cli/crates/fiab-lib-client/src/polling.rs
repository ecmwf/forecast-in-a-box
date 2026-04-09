use std::time::{Duration, Instant};

use crate::error::FiabError;

/// Poll `fetch` every `interval` until `is_done` returns true or `timeout` elapses.
pub async fn poll_until_done<F, Fut, T>(
    fetch: F,
    is_done: impl Fn(&T) -> bool,
    interval: Duration,
    timeout: Option<Duration>,
) -> Result<T, FiabError>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T, FiabError>>,
{
    let start = Instant::now();
    loop {
        let result = fetch().await?;
        if is_done(&result) {
            return Ok(result);
        }
        if let Some(t) = timeout {
            if start.elapsed() >= t {
                return Err(FiabError::Timeout);
            }
        }
        tokio::time::sleep(interval).await;
    }
}
