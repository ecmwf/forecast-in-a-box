use std::io::Write;
use std::time::Duration;

use fiab_client::FiabClient;
use fiab_client::error::FiabError;
use fiab_client::polling::poll_until_done;

use crate::cli::RunCmd;
use crate::render;

pub async fn run_run(client: &FiabClient, cmd: RunCmd, json: bool) -> anyhow::Result<()> {
    match cmd {
        RunCmd::Submit { workflow_id, workflow_version, wait, poll_interval } => {
            let resp = client.create_run(&workflow_id, workflow_version).await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else {
                println!("Run submitted.");
                println!("Run ID:  {}", resp.run_id);
                println!("Attempt: {}", resp.attempt_count);
            }
            if wait {
                do_wait(client, &resp.run_id, Some(resp.attempt_count), poll_interval, None, json).await?;
            }
        }

        RunCmd::List { page, page_size, all } => {
            if all {
                let runs = client.list_all_runs().await?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&runs)?);
                } else {
                    render::print_runs(&runs);
                }
            } else {
                let resp = client.list_runs(page, page_size).await?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&resp)?);
                } else {
                    eprintln!("Page {}/{} — {} total", resp.page, resp.total_pages, resp.total);
                    render::print_runs(&resp.runs);
                }
            }
        }

        RunCmd::Status { run_id, attempt } => {
            let r = client.get_run_opt(&run_id, attempt).await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&r)?);
            } else {
                render::print_run(&r);
            }
        }

        RunCmd::Wait { run_id, attempt, poll_interval, timeout } => {
            do_wait(client, &run_id, attempt, poll_interval, timeout, json).await?;
        }

        RunCmd::Restart { run_id, attempt, wait, poll_interval } => {
            let attempt_count = resolve_attempt(client, &run_id, attempt).await?;
            let resp = client.restart_run(&run_id, attempt_count).await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&resp)?);
            } else {
                println!("Run restarted.");
                println!("Run ID:  {}", resp.run_id);
                println!("Attempt: {}", resp.attempt_count);
            }
            if wait {
                do_wait(client, &resp.run_id, Some(resp.attempt_count), poll_interval, None, json).await?;
            }
        }

        RunCmd::Delete { run_id, attempt, yes: _ } => {
            let attempt_count = resolve_attempt(client, &run_id, attempt).await?;
            client.delete_run(&run_id, attempt_count).await?;
            if !json {
                println!("Run {} (attempt {}) deleted.", run_id, attempt_count);
            }
        }

        RunCmd::OutputsList { run_id, attempt } => {
            let attempt_count = resolve_attempt(client, &run_id, attempt).await?;
            let ids = client.get_run_output_availability(&run_id, attempt_count).await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&ids)?);
            } else {
                for id in &ids {
                    println!("{id}");
                }
            }
        }

        RunCmd::OutputsFetch { run_id, dataset_id, attempt, output, stdout } => {
            let attempt_count = resolve_attempt(client, &run_id, attempt).await?;
            let payload = client.get_run_output_content(&run_id, attempt_count, &dataset_id).await?;
            if stdout {
                std::io::stdout().write_all(&payload.bytes)?;
            } else if let Some(path) = output {
                std::fs::write(&path, &payload.bytes)?;
                if !json {
                    println!("Written to {}", path.display());
                }
            } else {
                let ct = payload.content_type.as_deref().unwrap_or("");
                if ct.starts_with("text/") || ct.contains("json") || ct.contains("xml") {
                    println!("{}", String::from_utf8_lossy(&payload.bytes));
                } else {
                    anyhow::bail!(
                        "Output is binary (content-type: {}). Use --output <PATH> or --stdout.",
                        ct
                    );
                }
            }
        }

        RunCmd::LogsDownload { run_id, attempt, output } => {
            let attempt_count = resolve_attempt(client, &run_id, attempt).await?;
            let payload = client.get_run_logs(&run_id, attempt_count).await?;
            let path = output.unwrap_or_else(|| {
                std::path::PathBuf::from(format!(
                    "run-{}-attempt-{}-logs.zip",
                    run_id, attempt_count
                ))
            });
            std::fs::write(&path, &payload.bytes)?;
            if !json {
                println!("Logs written to {}", path.display());
            }
        }
    }
    Ok(())
}

async fn resolve_attempt(
    client: &FiabClient,
    run_id: &str,
    attempt: Option<u32>,
) -> anyhow::Result<u32> {
    if let Some(a) = attempt {
        return Ok(a);
    }
    let r = client.get_run_opt(run_id, None).await?;
    Ok(r.attempt_count)
}

async fn do_wait(
    client: &FiabClient,
    run_id: &str,
    attempt: Option<u32>,
    poll_interval: u64,
    timeout_secs: Option<u64>,
    json: bool,
) -> anyhow::Result<()> {
    let run_id_owned = run_id.to_string();
    let interval = Duration::from_secs(poll_interval);
    let timeout = timeout_secs.map(Duration::from_secs);

    let result = poll_until_done(
        || {
            let rid = run_id_owned.clone();
            async move { client.get_run_opt(&rid, attempt).await }
        },
        |r| r.is_terminal(),
        interval,
        timeout,
    )
    .await;

    match result {
        Ok(r) => {
            if json {
                println!("{}", serde_json::to_string_pretty(&r)?);
            } else {
                render::print_run(&r);
            }
            if r.status == "failed" {
                anyhow::bail!("Run failed: {}", r.error.as_deref().unwrap_or("unknown"));
            }
        }
        Err(FiabError::Timeout) => {
            anyhow::bail!("Timed out waiting for run to complete");
        }
        Err(e) => return Err(e.into()),
    }
    Ok(())
}
