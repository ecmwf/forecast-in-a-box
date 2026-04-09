use serde_json::json;

use crate::client::FiabClient;
use crate::error::FiabError;
use crate::models::run::{BinaryPayload, RunCreateResponse, RunDetailResponse, RunListResponse};

impl FiabClient {
    pub async fn create_run(
        &self,
        blueprint_id: &str,
        blueprint_version: Option<u32>,
    ) -> Result<RunCreateResponse, FiabError> {
        let mut body = json!({ "blueprint_id": blueprint_id });
        if let Some(v) = blueprint_version {
            body["blueprint_version"] = json!(v);
        }
        let resp = self.execute(self.post("/run/create").json(&body)).await?;
        resp.json::<RunCreateResponse>().await.map_err(FiabError::Network)
    }

    pub async fn list_runs(&self, page: u32, page_size: u32) -> Result<RunListResponse, FiabError> {
        let resp = self
            .execute(self.get("/run/list").query(&[("page", page), ("page_size", page_size)]))
            .await?;
        resp.json::<RunListResponse>().await.map_err(FiabError::Network)
    }

    pub async fn get_run(&self, run_id: &str, attempt_count: u32) -> Result<RunDetailResponse, FiabError> {
        let resp = self
            .execute(
                self.get("/run/get")
                    .query(&[("run_id", run_id), ("attempt_count", &attempt_count.to_string())]),
            )
            .await?;
        resp.json::<RunDetailResponse>().await.map_err(FiabError::Network)
    }

    pub async fn get_run_opt(&self, run_id: &str, attempt_count: Option<u32>) -> Result<RunDetailResponse, FiabError> {
        let mut req = self.get("/run/get").query(&[("run_id", run_id)]);
        if let Some(a) = attempt_count {
            req = req.query(&[("attempt_count", a.to_string().as_str())]);
        }
        let resp = self.execute(req).await?;
        resp.json::<RunDetailResponse>().await.map_err(FiabError::Network)
    }

    pub async fn restart_run(&self, run_id: &str, attempt_count: u32) -> Result<RunCreateResponse, FiabError> {
        let resp = self
            .execute(
                self.post("/run/restart")
                    .json(&json!({ "run_id": run_id, "attempt_count": attempt_count })),
            )
            .await?;
        resp.json::<RunCreateResponse>().await.map_err(FiabError::Network)
    }

    pub async fn delete_run(&self, run_id: &str, attempt_count: u32) -> Result<(), FiabError> {
        self.execute(
            self.post("/run/delete")
                .json(&json!({ "run_id": run_id, "attempt_count": attempt_count })),
        )
        .await?;
        Ok(())
    }

    pub async fn get_run_output_availability(
        &self,
        run_id: &str,
        attempt_count: u32,
    ) -> Result<Vec<String>, FiabError> {
        let resp = self
            .execute(
                self.get("/run/outputAvailability")
                    .query(&[("run_id", run_id), ("attempt_count", &attempt_count.to_string())]),
            )
            .await?;
        resp.json::<Vec<String>>().await.map_err(FiabError::Network)
    }

    pub async fn get_run_output_content(
        &self,
        run_id: &str,
        attempt_count: u32,
        dataset_id: &str,
    ) -> Result<BinaryPayload, FiabError> {
        let resp = self
            .execute(
                self.get("/run/outputContent").query(&[
                    ("run_id", run_id),
                    ("attempt_count", &attempt_count.to_string()),
                    ("dataset_id", dataset_id),
                ]),
            )
            .await?;
        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(String::from);
        let bytes = resp.bytes().await.map_err(FiabError::Network)?;
        Ok(BinaryPayload { content_type, bytes })
    }

    pub async fn get_run_logs(&self, run_id: &str, attempt_count: u32) -> Result<BinaryPayload, FiabError> {
        let resp = self
            .execute(
                self.get("/run/logs")
                    .query(&[("run_id", run_id), ("attempt_count", &attempt_count.to_string())]),
            )
            .await?;
        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(String::from);
        let bytes = resp.bytes().await.map_err(FiabError::Network)?;
        Ok(BinaryPayload { content_type, bytes })
    }

    /// Return the `RunDetailResponse` for the highest `attempt_count` seen for a given `run_id`.
    pub async fn get_latest_run_attempt(&self, run_id: &str) -> Result<RunDetailResponse, FiabError> {
        let mut page = 1u32;
        let mut best: Option<RunDetailResponse> = None;
        loop {
            match self.list_runs(page, 100).await {
                Ok(resp) => {
                    let total_pages = resp.total_pages;
                    for r in resp.runs {
                        if r.run_id == run_id {
                            if best.as_ref().map_or(true, |b| r.attempt_count > b.attempt_count) {
                                best = Some(r);
                            }
                        }
                    }
                    if page >= total_pages {
                        break;
                    }
                    page += 1;
                }
                Err(FiabError::NotFound(_)) => break,
                Err(e) => return Err(e),
            }
        }
        match best {
            Some(r) => self.get_run(&r.run_id, r.attempt_count).await,
            None => Err(FiabError::NotFound(format!("run {}", run_id))),
        }
    }

    pub async fn list_all_runs(&self) -> Result<Vec<RunDetailResponse>, FiabError> {
        let mut all = Vec::new();
        let mut page = 1u32;
        loop {
            match self.list_runs(page, 100).await {
                Ok(resp) => {
                    let total_pages = resp.total_pages;
                    all.extend(resp.runs);
                    if page >= total_pages {
                        break;
                    }
                    page += 1;
                }
                Err(FiabError::NotFound(_)) => break,
                Err(e) => return Err(e),
            }
        }
        Ok(all)
    }
}
