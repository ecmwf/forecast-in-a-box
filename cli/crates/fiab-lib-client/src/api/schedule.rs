use serde_json::json;

use crate::client::FiabClient;
use crate::error::FiabError;
use crate::models::run::RunDetailResponse;
use crate::models::schedule::{
    CreateScheduleRequest, CreateScheduleResponse, NextRunResponse, ScheduleDetail,
    ScheduleListResponse, ScheduleRunsResponse, UpdateScheduleRequest,
};

impl FiabClient {
    pub async fn create_schedule(&self, req: &CreateScheduleRequest) -> Result<CreateScheduleResponse, FiabError> {
        let resp = self.execute(self.put("/experiment/create").json(req)).await?;
        resp.json::<CreateScheduleResponse>().await.map_err(FiabError::Network)
    }

    pub async fn list_schedules(&self, page: u32, page_size: u32) -> Result<ScheduleListResponse, FiabError> {
        let resp = self
            .execute(
                self.get("/experiment/list")
                    .query(&[("page", page), ("page_size", page_size)]),
            )
            .await?;
        resp.json::<ScheduleListResponse>().await.map_err(FiabError::Network)
    }

    pub async fn get_schedule(&self, experiment_id: &str) -> Result<ScheduleDetail, FiabError> {
        let resp = self
            .execute(self.get("/experiment/get").query(&[("experiment_id", experiment_id)]))
            .await?;
        resp.json::<ScheduleDetail>().await.map_err(FiabError::Network)
    }

    pub async fn update_schedule(&self, req: &UpdateScheduleRequest) -> Result<ScheduleDetail, FiabError> {
        let resp = self.execute(self.post("/experiment/update").json(req)).await?;
        resp.json::<ScheduleDetail>().await.map_err(FiabError::Network)
    }

    pub async fn delete_schedule(&self, experiment_id: &str, version: u32) -> Result<(), FiabError> {
        self.execute(
            self.post("/experiment/delete")
                .json(&json!({ "experiment_id": experiment_id, "version": version })),
        )
        .await?;
        Ok(())
    }

    pub async fn list_schedule_runs(
        &self,
        experiment_id: &str,
        page: u32,
        page_size: u32,
    ) -> Result<ScheduleRunsResponse, FiabError> {
        let resp = self
            .execute(self.get("/experiment/runs/list").query(&[
                ("experiment_id", experiment_id),
                ("page", &page.to_string()),
                ("page_size", &page_size.to_string()),
            ]))
            .await?;
        resp.json::<ScheduleRunsResponse>().await.map_err(FiabError::Network)
    }

    pub async fn get_schedule_next_run(&self, experiment_id: &str) -> Result<NextRunResponse, FiabError> {
        let resp = self
            .execute(self.get("/experiment/runs/next").query(&[("experiment_id", experiment_id)]))
            .await?;
        let text = resp.text().await.map_err(FiabError::Network)?;
        let trimmed = text.trim().trim_matches('"').to_string();
        Ok(if trimmed.to_lowercase().contains("not scheduled") || trimmed.is_empty() {
            NextRunResponse::NotScheduled
        } else {
            NextRunResponse::Scheduled(trimmed)
        })
    }

    pub async fn get_scheduler_current_time(&self) -> Result<String, FiabError> {
        let resp = self
            .execute(self.get("/experiment/operational/scheduler/current_time"))
            .await?;
        let text = resp.text().await.map_err(FiabError::Network)?;
        Ok(text.trim().trim_matches('"').to_string())
    }

    pub async fn restart_scheduler(&self) -> Result<(), FiabError> {
        self.execute(self.post("/experiment/operational/scheduler/restart").json(&json!(null)))
            .await?;
        Ok(())
    }

    pub async fn get_latest_schedule_version(&self, experiment_id: &str) -> Result<u32, FiabError> {
        let detail = self.get_schedule(experiment_id).await?;
        Ok(detail.experiment_version)
    }

    pub async fn list_all_schedules(&self) -> Result<Vec<ScheduleDetail>, FiabError> {
        let mut all = Vec::new();
        let mut page = 1u32;
        loop {
            match self.list_schedules(page, 100).await {
                Ok(resp) => {
                    let total_pages = resp.total_pages;
                    all.extend(resp.experiments);
                    if page >= total_pages {
                        break;
                    }
                    page += 1;
                }
                // Smooth out 400 on out-of-range pages
                Err(FiabError::Http { status: 400, .. }) => break,
                Err(e) => return Err(e),
            }
        }
        Ok(all)
    }

    pub async fn list_all_schedule_runs(&self, experiment_id: &str) -> Result<Vec<RunDetailResponse>, FiabError> {
        let mut all = Vec::new();
        let mut page = 1u32;
        loop {
            match self.list_schedule_runs(experiment_id, page, 100).await {
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
