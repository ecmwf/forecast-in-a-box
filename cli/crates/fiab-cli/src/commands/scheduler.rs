use fiab_lib_client::FiabClient;

use crate::cli::SchedulerCmd;
use crate::commands::CliError;

pub async fn run(client: &FiabClient, cmd: SchedulerCmd, json: bool) -> Result<(), CliError> {
    match cmd {
        SchedulerCmd::Time => {
            let time = client.get_scheduler_current_time().await?;
            if json {
                println!("{}", serde_json::json!({ "current_time": time }));
            } else {
                println!("Scheduler time: {}", time);
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
