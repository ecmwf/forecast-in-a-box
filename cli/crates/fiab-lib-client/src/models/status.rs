use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusResponse {
    pub api: String,
    pub cascade: String,
    pub ecmwf: String,
    pub scheduler: String,
    pub version: String,
    pub plugins: String,
}
