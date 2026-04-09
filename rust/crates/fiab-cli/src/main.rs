mod cli;
mod commands;
mod config;
mod render;

use clap::Parser;
use cli::{Cli, Command};
use fiab_client::FiabClient;

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    let client_config = config::build_client_config(
        cli.server.clone(),
        &cli.profile,
        cli.timeout,
    );

    let client = match FiabClient::new(client_config) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Error building client: {e}");
            std::process::exit(2);
        }
    };

    let result = dispatch(&client, cli.command, cli.json).await;

    if let Err(e) = result {
        let exit_code = if let Some(fe) = e.downcast_ref::<fiab_client::FiabError>() {
            fe.exit_code()
        } else {
            1
        };
        eprintln!("Error: {e}");
        std::process::exit(exit_code);
    }
}

async fn dispatch(client: &FiabClient, command: Command, json: bool) -> anyhow::Result<()> {
    match command {
        Command::Status => commands::status::run_status(client, json).await,
        Command::Workflow(args) => commands::workflow::run_workflow(client, args.cmd, json).await,
        Command::Run(args) => commands::run::run_run(client, args.cmd, json).await,
        Command::Schedule(args) => commands::schedule::run_schedule(client, args.cmd, json).await,
        Command::Scheduler(args) => commands::scheduler::run_scheduler(client, args.cmd, json).await,
    }
}
