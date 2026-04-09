use serde::{Deserialize, Serialize};
use crate::models::run::RunDetailResponse;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleDetail {
    pub experiment_id: String,
    pub experiment_version: u32,
    pub blueprint_id: String,
    pub blueprint_version: u32,
    pub cron_expr: String,
    pub max_acceptable_delay_hours: u32,
    pub enabled: bool,
    pub created_at: String,
    pub created_by: Option<String>,
    pub display_name: Option<String>,
    pub display_description: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateScheduleRequest {
    pub blueprint_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blueprint_version: Option<u32>,
    pub cron_expr: String,
    pub max_acceptable_delay_hours: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_run_override: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateScheduleResponse {
    pub experiment_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateScheduleRequest {
    pub experiment_id: String,
    pub version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cron_expr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_acceptable_delay_hours: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_run_override: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleListResponse {
    pub experiments: Vec<ScheduleDetail>,
    pub total: u32,
    pub page: u32,
    pub page_size: u32,
    pub total_pages: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleRunsResponse {
    pub runs: Vec<RunDetailResponse>,
    pub total: u32,
    pub page: u32,
    pub page_size: u32,
    pub total_pages: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NextRunResponse {
    Scheduled(String),
    NotScheduled,
    Unknown(String),
}

