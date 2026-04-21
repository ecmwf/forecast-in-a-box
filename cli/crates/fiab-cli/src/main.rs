mod cli;
mod commands;
mod config;
mod render;

use clap::Parser;
use cli::{Cli, Command};
use fiab_lib_client::FiabClient;

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    let profile = cli.profile.clone();
    let client_config = config::build_client_config(cli.server.clone(), &profile, cli.timeout);

    if cli.verbose {
        eprintln!(
            "Connecting to {} (profile: {})",
            client_config.server_url, profile
        );
    }

    let client = match FiabClient::new(client_config) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Error building client: {}", e);
            std::process::exit(2);
        }
    };

    let result = match cli.command {
        Command::Status => commands::status::run(&client, cli.json).await,
        Command::Workflow(args) => commands::workflow::run(&client, args.cmd, cli.json).await,
        Command::Run(args) => commands::run::run(&client, args.cmd, cli.json).await,
        Command::Schedule(args) => commands::schedule::run(&client, args.cmd, cli.json).await,
        Command::Scheduler(args) => commands::scheduler::run(&client, args.cmd, cli.json).await,
    };

    if let Err(e) = result {
        eprintln!("Error: {}", e);
        std::process::exit(e.exit_code());
    }
}
