use std::io::Write;
use std::time::Duration;

use fiab_lib_client::FiabClient;

use crate::cli::RunCmd;
use crate::commands::CliError;
use crate::render;

pub async fn run(client: &FiabClient, cmd: RunCmd, json: bool) -> Result<(), CliError> {
    match cmd {
        RunCmd::Submit { workflow_id, workflow_version, wait, poll_interval } => {
            let created = client.create_run(&workflow_id, workflow_version).await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&created).unwrap());
            } else {
                println!("Run submitted: {} (attempt {})", created.run_id, created.attempt_count);
            }
            if wait {
                let interval = Duration::from_secs(poll_interval);
                wait_for_run(client, &created.run_id, created.attempt_count, interval, None, json).await?;
            }
        }

        RunCmd::List { page, page_size, all } => {
            if all {
                let runs = client.list_all_runs().await?;
                render::render_run_list(&runs, json);
            } else {
                let resp = client.list_runs(page, page_size).await?;
                render::render_run_list(&resp.runs, json);
            }
        }

        RunCmd::Status { run_id, attempt } => {
            let attempt_count = resolve_attempt(client, &run_id, attempt).await?;
            let detail = client.get_run(&run_id, attempt_count).await?;
            render::render_run_detail(&detail, json);
        }

        RunCmd::Wait { run_id, attempt, poll_interval, timeout } => {
            let attempt_count = resolve_attempt(client, &run_id, attempt).await?;
            let interval = Duration::from_secs(poll_interval);
            let timeout_dur = timeout.map(Duration::from_secs);
            wait_for_run(client, &run_id, attempt_count, interval, timeout_dur, json).await?;
        }

        RunCmd::Restart { run_id, attempt, wait, poll_interval } => {
            let attempt_count = resolve_attempt(client, &run_id, attempt).await?;
            let created = client.restart_run(&run_id, attempt_count).await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&created).unwrap());
            } else {
                println!("Restarted: {} (attempt {})", created.run_id, created.attempt_count);
            }
            if wait {
                let interval = Duration::from_secs(poll_interval);
                wait_for_run(client, &created.run_id, created.attempt_count, interval, None, json).await?;
            }
        }

        RunCmd::Delete { run_id, attempt, yes } => {
            let attempt_count = resolve_attempt(client, &run_id, attempt).await?;
            if !yes {
                eprint!("Delete run {} attempt {}? [y/N] ", run_id, attempt_count);
                std::io::stderr().flush().ok();
                let mut input = String::new();
                std::io::stdin().read_line(&mut input).ok();
                if !input.trim().eq_ignore_ascii_case("y") {
                    eprintln!("Aborted.");
                    return Ok(());
                }
            }
            client.delete_run(&run_id, attempt_count).await?;
            if !json {
                println!("Deleted run {} attempt {}", run_id, attempt_count);
            }
        }

        RunCmd::OutputsList { run_id, attempt } => {
            let attempt_count = resolve_attempt(client, &run_id, attempt).await?;
            let detail = client.get_run(&run_id, attempt_count).await?;
            render::render_run_outputs(&detail, json);
        }

        RunCmd::OutputsFetch { run_id, dataset_id, attempt, output, stdout } => {
            let attempt_count = resolve_attempt(client, &run_id, attempt).await?;
            let payload = client.get_run_output_content(&run_id, attempt_count, &dataset_id).await?;
            let is_text = payload
                .content_type
                .as_deref()
                .map(|ct| ct.starts_with("text/"))
                .unwrap_or(false);

            if let Some(path) = output {
                std::fs::write(&path, &payload.bytes)?;
                if !json {
                    println!("Saved to {}", path.display());
                }
            } else if stdout {
                std::io::stdout().write_all(&payload.bytes)?;
            } else if is_text {
                let text = String::from_utf8_lossy(&payload.bytes);
                print!("{}", text);
            } else {
                return Err(CliError::Usage(
                    "Binary content: use --output <PATH> or --stdout".to_string(),
                ));
            }
        }

        RunCmd::LogsDownload { run_id, attempt, output } => {
            let attempt_count = resolve_attempt(client, &run_id, attempt).await?;
            let payload = client.get_run_logs(&run_id, attempt_count).await?;
            let path = output
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_else(|| format!("./run-{}-attempt-{}-logs.zip", run_id, attempt_count));
            std::fs::write(&path, &payload.bytes)?;
            if !json {
                println!("Logs saved to {}", path);
            }
        }
    }
    Ok(())
}

async fn resolve_attempt(client: &FiabClient, run_id: &str, attempt: Option<u32>) -> Result<u32, CliError> {
    match attempt {
        Some(a) => Ok(a),
        None => {
            let detail = client.get_latest_run_attempt(run_id).await?;
            Ok(detail.attempt_count)
        }
    }
}

async fn wait_for_run(
    client: &FiabClient,
    run_id: &str,
    attempt_count: u32,
    interval: Duration,
    timeout: Option<Duration>,
    json: bool,
) -> Result<(), CliError> {
    use fiab_lib_client::polling::poll_until_done;

    let run_id = run_id.to_string();
    let detail = poll_until_done(
        || {
            let c = client.clone();
            let id = run_id.clone();
            async move { c.get_run(&id, attempt_count).await }
        },
        |r| matches!(r.status.as_str(), "completed" | "failed" | "error"),
        interval,
        timeout,
    )
    .await?;

    render::render_run_detail(&detail, json);

    if detail.status != "completed" {
        return Err(CliError::RunFailed(detail.status));
    }
    Ok(())
}
