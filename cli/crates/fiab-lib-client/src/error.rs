use thiserror::Error;

#[derive(Debug, Error)]
pub enum FiabError {
    #[error("HTTP {status}: {message}")]
    Http { status: u16, message: String },

    #[error("Authentication required or forbidden")]
    Auth,

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Conflict: {0}")]
    Conflict(String),

    #[error("Service unavailable")]
    ServiceUnavailable,

    #[error("Request error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("Timeout waiting for completion")]
    Timeout,

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Run finished with status: {0}")]
    RunFailed(String),
}

impl FiabError {
    pub fn exit_code(&self) -> i32 {
        match self {
            FiabError::Config(_) => 2,
            FiabError::Auth => 3,
            FiabError::NotFound(_) => 4,
            FiabError::Conflict(_) => 5,
            FiabError::ServiceUnavailable => 6,
            FiabError::Network(_) | FiabError::Timeout => 7,
            _ => 1,
        }
    }
}
