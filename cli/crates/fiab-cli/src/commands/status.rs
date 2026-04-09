use fiab_lib_client::FiabClient;
use crate::commands::CliError;
use crate::render;

pub async fn run(client: &FiabClient, json: bool) -> Result<(), CliError> {
    let status = client.get_status().await?;
    render::render_status(&status, json);
    Ok(())
}
