use fiab_client::FiabClient;
use crate::cli::SchedulerCmd;

pub async fn run_scheduler(client: &FiabClient, cmd: SchedulerCmd, json: bool) -> anyhow::Result<()> {
    match cmd {
        SchedulerCmd::Time => {
            let t = client.get_scheduler_current_time().await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&t)?);
            } else {
                println!("{t}");
            }
        }
        SchedulerCmd::Restart => {
            client.restart_scheduler().await?;
            if !json {
                println!("Scheduler restarted.");
            }
        }
    }
    Ok(())
}
