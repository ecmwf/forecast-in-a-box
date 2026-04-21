use fiab_lib_client::models::schedule::{CreateScheduleRequest, UpdateScheduleRequest};
use fiab_lib_client::FiabClient;

use crate::cli::ScheduleCmd;
use crate::commands::CliError;
use crate::render;

pub async fn run(client: &FiabClient, cmd: ScheduleCmd, json: bool) -> Result<(), CliError> {
    match cmd {
        ScheduleCmd::List { page, page_size, all } => {
            if all {
                let schedules = client.list_all_schedules().await?;
                render::render_schedule_list(&schedules, json);
            } else {
                let resp = client.list_schedules(page, page_size).await?;
                render::render_schedule_list(&resp.experiments, json);
            }
        }

        ScheduleCmd::Show { schedule_id } => {
            let detail = client.get_schedule(&schedule_id).await?;
            render::render_schedule_detail(&detail, json);
        }

        ScheduleCmd::Create {
            workflow_id,
            cron,
            workflow_version,
            max_acceptable_delay_hours,
            first_run_override,
            name,
            description,
            tags,
        } => {
            let tag_list = if tags.is_empty() { None } else { Some(tags) };
            let req = CreateScheduleRequest {
                blueprint_id: workflow_id,
                blueprint_version: workflow_version,
                cron_expr: cron,
                max_acceptable_delay_hours,
                first_run_override,
                display_name: name,
                display_description: description,
                tags: tag_list,
            };
            let resp = client.create_schedule(&req).await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&resp).unwrap());
            } else {
                println!("Schedule created: {}", resp.experiment_id);
            }
        }

        ScheduleCmd::Update {
            schedule_id,
            version,
            cron,
            enable,
            disable,
            max_acceptable_delay_hours,
            first_run_override,
        } => {
            let ver = match version {
                Some(v) => v,
                None => client.get_latest_schedule_version(&schedule_id).await?,
            };
            let enabled = match (enable, disable) {
                (true, false) => Some(true),
                (false, true) => Some(false),
                _ => None,
            };
            let req = UpdateScheduleRequest {
                experiment_id: schedule_id,
                version: ver,
                cron_expr: cron,
                enabled,
                max_acceptable_delay_hours,
                first_run_override,
            };
            let detail = client.update_schedule(&req).await?;
            render::render_schedule_detail(&detail, json);
        }

        ScheduleCmd::Delete { schedule_id, version } => {
            let ver = match version {
                Some(v) => v,
                None => client.get_latest_schedule_version(&schedule_id).await?,
            };
            client.delete_schedule(&schedule_id, ver).await?;
            if !json {
                println!("Deleted schedule {}", schedule_id);
            }
        }

        ScheduleCmd::Runs { schedule_id, page, page_size, all } => {
            if all {
                let runs = client.list_all_schedule_runs(&schedule_id).await?;
                render::render_run_list(&runs, json);
            } else {
                let resp = client.list_schedule_runs(&schedule_id, page, page_size).await?;
                render::render_run_list(&resp.runs, json);
            }
        }

        ScheduleCmd::Next { schedule_id } => {
            let next = client.get_schedule_next_run(&schedule_id).await?;
            render::render_next_run(&next, json);
        }
    }
    Ok(())
}
