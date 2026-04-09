use fiab_lib_client::FiabClient;
use crate::cli::WorkflowCmd;
use crate::commands::CliError;
use crate::render;

pub async fn run(client: &FiabClient, cmd: WorkflowCmd, json: bool) -> Result<(), CliError> {
    match cmd {
        WorkflowCmd::List { page, page_size, all } => {
            if all {
                let workflows = client.list_all_workflows().await?;
                render::render_workflow_list(&workflows, json);
            } else {
                let resp = client.list_workflows(page, page_size).await?;
                render::render_workflow_list(&resp.blueprints, json);
            }
        }
        WorkflowCmd::Show { workflow_id, version } => {
            let detail = client.get_workflow(&workflow_id, version).await?;
            render::render_workflow_detail(&detail, json);
        }
    }
    Ok(())
}
