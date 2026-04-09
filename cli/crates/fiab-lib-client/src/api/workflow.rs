use crate::client::FiabClient;
use crate::error::FiabError;
use crate::models::workflow::{WorkflowDetail, WorkflowListResponse};

impl FiabClient {
    pub async fn list_workflows(&self, page: u32, page_size: u32) -> Result<WorkflowListResponse, FiabError> {
        let resp = self
            .execute(self.get("/blueprint/list").query(&[("page", page), ("page_size", page_size)]))
            .await?;
        resp.json::<WorkflowListResponse>().await.map_err(FiabError::Network)
    }

    pub async fn get_workflow(&self, blueprint_id: &str, version: Option<u32>) -> Result<WorkflowDetail, FiabError> {
        let mut req = self.get("/blueprint/get").query(&[("blueprint_id", blueprint_id)]);
        if let Some(v) = version {
            req = req.query(&[("version", v.to_string().as_str())]);
        }
        let resp = self.execute(req).await?;
        resp.json::<WorkflowDetail>().await.map_err(FiabError::Network)
    }

    pub async fn list_all_workflows(&self) -> Result<Vec<WorkflowDetail>, FiabError> {
        let mut all = Vec::new();
        let mut page = 1u32;
        loop {
            let resp = self.list_workflows(page, 100).await?;
            let fetched = resp.blueprints.len() as u32;
            all.extend(resp.blueprints);
            if fetched < 100 || all.len() as u32 >= resp.total {
                break;
            }
            page += 1;
        }
        Ok(all)
    }
}
