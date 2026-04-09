use crate::client::FiabClient;
use crate::error::FiabError;
use crate::models::status::StatusResponse;

impl FiabClient {
    pub async fn get_status(&self) -> Result<StatusResponse, FiabError> {
        let resp = self.execute(self.get("/status")).await?;
        resp.json::<StatusResponse>().await.map_err(FiabError::Network)
    }
}
