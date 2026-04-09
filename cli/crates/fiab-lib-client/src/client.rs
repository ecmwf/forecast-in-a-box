use reqwest::{Client as HttpClient, RequestBuilder, Response};
use std::time::Duration;

use crate::config::ClientConfig;
use crate::error::FiabError;

#[derive(Debug, Clone)]
pub struct FiabClient {
    pub(crate) http: HttpClient,
    pub(crate) base_url: String,
    pub(crate) config: ClientConfig,
}

impl FiabClient {
    pub fn new(config: ClientConfig) -> Result<Self, FiabError> {
        let mut headers = reqwest::header::HeaderMap::new();
        if let Some(ref token) = config.auth_token {
            if !token.is_empty() {
                let cookie_value = format!("forecastbox_auth={}", token);
                headers.insert(
                    reqwest::header::COOKIE,
                    reqwest::header::HeaderValue::from_str(&cookie_value)
                        .map_err(|e| FiabError::Config(e.to_string()))?,
                );
            }
        }

        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_seconds))
            .default_headers(headers)
            .build()
            .map_err(FiabError::Network)?;

        let base_url = format!("{}/api/v1", config.server_url.trim_end_matches('/'));

        Ok(Self { http, base_url, config })
    }

    pub fn get(&self, path: &str) -> RequestBuilder {
        self.http.get(format!("{}{}", self.base_url, path))
    }

    pub fn post(&self, path: &str) -> RequestBuilder {
        self.http.post(format!("{}{}", self.base_url, path))
    }

    pub fn put(&self, path: &str) -> RequestBuilder {
        self.http.put(format!("{}{}", self.base_url, path))
    }

    pub async fn execute(&self, req: RequestBuilder) -> Result<Response, FiabError> {
        let resp = req.send().await.map_err(FiabError::Network)?;
        let status = resp.status();
        if !status.is_success() {
            let code = status.as_u16();
            let message = resp.text().await.unwrap_or_default();
            return Err(match code {
                400 | 422 => FiabError::Http { status: code, message },
                401 | 403 => FiabError::Auth,
                404 => FiabError::NotFound(message),
                409 => FiabError::Conflict(message),
                503 => FiabError::ServiceUnavailable,
                _ => FiabError::Http { status: code, message },
            });
        }
        Ok(resp)
    }

    pub fn poll_interval(&self) -> Duration {
        Duration::from_secs(self.config.poll_interval_seconds)
    }
}
