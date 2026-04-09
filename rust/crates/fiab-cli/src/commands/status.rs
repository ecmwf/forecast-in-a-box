use fiab_client::FiabClient;
use crate::render;

pub async fn run_status(client: &FiabClient, json: bool) -> anyhow::Result<()> {
    let status = client.get_status().await?;
    if json {
        println!("{}", serde_json::to_string_pretty(&status)?);
    } else {
        render::print_status(&status);
    }
    Ok(())
}
