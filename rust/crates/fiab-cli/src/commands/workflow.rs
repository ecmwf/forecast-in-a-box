use fiab_client::FiabClient;
use crate::cli::WorkflowCmd;
use crate::render;

pub async fn run_workflow(client: &FiabClient, cmd: WorkflowCmd, json: bool) -> anyhow::Result<()> {
    match cmd {
        WorkflowCmd::List { page, page_size, all } => {
            if all {
                let workflows = client.list_all_workflows().await?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&workflows)?);
                } else {
                    render::print_workflows(&workflows);
                }
            } else {
                let resp = client.list_workflows(page, page_size).await?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&resp)?);
                } else {
                    eprintln!("Page {}/{} — {} total", resp.page,
                        (resp.total + resp.page_size - 1) / resp.page_size.max(1), resp.total);
                    render::print_workflows(&resp.blueprints);
                }
            }
        }
        WorkflowCmd::Show { workflow_id, version } => {
            let w = client.get_workflow(&workflow_id, version).await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&w)?);
            } else {
                render::print_workflow(&w);
            }
        }
    }
    Ok(())
}
