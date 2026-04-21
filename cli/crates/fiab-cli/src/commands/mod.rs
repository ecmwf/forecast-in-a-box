pub mod status;
pub mod workflow;
pub mod run;
pub mod schedule;
pub mod scheduler;

use fiab_lib_client::FiabError;
use std::fmt;

#[derive(Debug)]
pub enum CliError {
    Client(FiabError),
    Io(std::io::Error),
    Usage(String),
    RunFailed(String),
}

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CliError::Client(e) => write!(f, "{}", e),
            CliError::Io(e) => write!(f, "IO error: {}", e),
            CliError::Usage(s) => write!(f, "Usage error: {}", s),
            CliError::RunFailed(s) => write!(f, "Run failed with status: {}", s),
        }
    }
}

impl CliError {
    pub fn exit_code(&self) -> i32 {
        match self {
            CliError::Client(e) => e.exit_code(),
            CliError::Io(_) => 1,
            CliError::Usage(_) => 2,
            CliError::RunFailed(_) => 1,
        }
    }
}

impl From<FiabError> for CliError {
    fn from(e: FiabError) -> Self {
        CliError::Client(e)
    }
}

impl From<std::io::Error> for CliError {
    fn from(e: std::io::Error) -> Self {
        CliError::Io(e)
    }
}
