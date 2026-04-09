use fiab_client::FiabClient;
use fiab_client::models::schedule::{CreateScheduleRequest, NextRunResponse, UpdateScheduleRequest};
use crate::cli::ScheduleCmd;
use crate::render;

pub async fn run_schedule(client: &FiabClient, cmd: ScheduleCmd, json: bool) -> anyhow::Result<()> {
    match cmd {
        ScheduleCmd::List { page, page_size, all } => {
            if all {
                let schedules = client.list_all_schedules().await?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&schedules)?);
                } else {
                    render::print_schedules(&schedules);
                }
            } else {
                let resp = client.list_schedules(page, page_size).await?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&resp)?);
                } else {
                    eprintln!("Page {}/{} — {} total", resp.page, resp.total_pages, resp.total);
                    render::print_schedules(&resp.experiments);
                }
            }
        }

        ScheduleCmd::Show { schedule_id } => {
            let s = client.get_schedule(&schedule_id).await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&s)?);
            } else {
                render::print_schedule(&s);
            }
        }

        ScheduleCmd::Create {
            workflow_id, workflow_version, cron, max_acceptable_delay_hours,
            first_run_override, name, description, tags,
        } => {
            let req = CreateScheduleRequest {
                blueprint_id: workflow_id,
                blueprint_version: workflow_version,
                cron_expr: cron,
                max_acceptable_delay_hours,
                first_run_override,
                display_name: name,
                display_description: description,
                tags: if tags.is_empty() { None } else { Some(tags) },
            };
            let resp = client.create_schedule(&req).await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else {
                println!("Schedule created.");
                println!("Schedule ID: {}", resp.experiment_id);
            }
        }

        ScheduleCmd::Update {
            schedule_id, version, cron, enable, disable,
            max_acceptable_delay_hours, first_run_override,
        } => {
            let v = match version {
                Some(v) => v,
                None => client.get_latest_schedule_version(&schedule_id).await?,
            };
            let enabled = if enable { Some(true) } else if disable { Some(false) } else { None };
            if cron.is_none() && enabled.is_none() && max_acceptable_delay_hours.is_none()
                && first_run_override.is_none()
            {
                anyhow::bail!("At least one of --cron, --enable, --disable, --max-acceptable-delay-hours, --first-run-override must be provided");
            }
            let req = UpdateScheduleRequest {
                experiment_id: schedule_id,
                version: v,
                cron_expr: cron,
                enabled,
                max_acceptable_delay_hours,
                first_run_override,
            };
            let s = client.update_schedule(&req).await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&s)?);
            } else {
                println!("Schedule updated.");
                render::print_schedule(&s);
            }
        }

        ScheduleCmd::Delete { schedule_id, version } => {
            let v = match version {
                Some(v) => v,
                None => client.get_latest_schedule_version(&schedule_id).await?,
            };
            client.delete_schedule(&schedule_id, v).await?;
            if !json {
                println!("Schedule {} deleted.", schedule_id);
            }
        }

        ScheduleCmd::Runs { schedule_id, page, page_size, all } => {
            if all {
                let runs = client.list_all_schedule_runs(&schedule_id).await?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&runs)?);
                } else {
                    render::print_runs(&runs);
                }
            } else {
                let resp = client.list_schedule_runs(&schedule_id, page, page_size).await?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&resp)?);
                } else {
                    eprintln!("Page {}/{} — {} total", resp.page, resp.total_pages, resp.total);
                    render::print_runs(&resp.runs);
                }
            }
        }

        ScheduleCmd::Next { schedule_id } => {
            let next = client.get_schedule_next_run(&schedule_id).await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&next)?);
            } else {
                match next {
                    NextRunResponse::Scheduled(ts) => println!("{ts}"),
                    NextRunResponse::NotScheduled => println!("not scheduled currently"),
                    NextRunResponse::Unknown(s) => println!("{s}"),
                }
            }
        }
    }
    Ok(())
}
