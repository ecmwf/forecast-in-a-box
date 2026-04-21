use serde::{Deserialize, Serialize};

pub struct BinaryPayload {
    pub content_type: Option<String>,
    pub bytes: bytes::Bytes,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunDetailResponse {
    pub run_id: String,
    pub attempt_count: u32,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub blueprint_id: String,
    pub blueprint_version: u32,
    pub error: Option<String>,
    pub progress: Option<String>,
    pub cascade_job_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunCreateResponse {
    pub run_id: String,
    pub attempt_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunListResponse {
    pub runs: Vec<RunDetailResponse>,
    pub total: u32,
    pub page: u32,
    pub page_size: u32,
    pub total_pages: u32,
}

impl RunDetailResponse {
    pub fn is_terminal(&self) -> bool {
        matches!(self.status.as_str(), "completed" | "failed")
    }
}

