use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowDetail {
    pub blueprint_id: String,
    pub version: u32,
    pub builder: Option<serde_json::Value>,
    pub display_name: Option<String>,
    pub display_description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub parent_id: Option<String>,
    pub source: Option<String>,
    pub created_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowListResponse {
    pub blueprints: Vec<WorkflowDetail>,
    pub total: u32,
    pub page: u32,
    pub page_size: u32,
}
