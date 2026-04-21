#[derive(Debug, Clone)]
pub struct ClientConfig {
    pub server_url: String,
    pub auth_token: Option<String>,
    pub timeout_seconds: u64,
    pub poll_interval_seconds: u64,
}

impl Default for ClientConfig {
    fn default() -> Self {
        Self {
            server_url: "http://localhost:8000".to_string(),
            auth_token: None,
            timeout_seconds: 30,
            poll_interval_seconds: 2,
        }
    }
}
