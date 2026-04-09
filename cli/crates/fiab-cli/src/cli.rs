use clap::{Args, Parser, Subcommand};

#[derive(Parser, Debug)]
#[command(name = "fiab", about = "ForecastBox CLI", version)]
pub struct Cli {
    /// Backend server URL (e.g. http://localhost:8000)
    #[arg(long, global = true, env = "FIAB_SERVER_URL")]
    pub server: Option<String>,

    /// Config profile name
    #[arg(long, global = true, default_value = "default", env = "FIAB_PROFILE")]
    pub profile: String,

    /// Output JSON instead of human-readable tables
    #[arg(long, global = true, default_value = "false")]
    pub json: bool,

    /// Request timeout in seconds
    #[arg(long, global = true)]
    pub timeout: Option<u64>,

    /// Verbose output
    #[arg(long, global = true, default_value = "false")]
    pub verbose: bool,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand, Debug)]
pub enum Command {
    /// Show backend health and version
    Status,
    /// Inspect saved workflow definitions
    Workflow(WorkflowArgs),
    /// Manage and inspect runs
    Run(RunArgs),
    /// Manage cron schedules
    Schedule(ScheduleArgs),
    /// Scheduler operational commands
    Scheduler(SchedulerArgs),
}

// ── Workflow ──────────────────────────────────────────────────────────────────

#[derive(Args, Debug)]
pub struct WorkflowArgs {
    #[command(subcommand)]
    pub cmd: WorkflowCmd,
}

#[derive(Subcommand, Debug)]
pub enum WorkflowCmd {
    /// List saved workflows
    List {
        #[arg(long, default_value = "1")]
        page: u32,
        #[arg(long, default_value = "10")]
        page_size: u32,
        #[arg(long)]
        all: bool,
    },
    /// Show a single workflow definition
    Show {
        workflow_id: String,
        #[arg(long)]
        version: Option<u32>,
    },
}

// ── Run ───────────────────────────────────────────────────────────────────────

#[derive(Args, Debug)]
pub struct RunArgs {
    #[command(subcommand)]
    pub cmd: RunCmd,
}

#[derive(Subcommand, Debug)]
pub enum RunCmd {
    /// Submit a run from a workflow
    Submit {
        #[arg(long)]
        workflow_id: String,
        #[arg(long)]
        workflow_version: Option<u32>,
        #[arg(long)]
        wait: bool,
        #[arg(long, default_value = "2")]
        poll_interval: u64,
    },
    /// List runs
    List {
        #[arg(long, default_value = "1")]
        page: u32,
        #[arg(long, default_value = "10")]
        page_size: u32,
        #[arg(long)]
        all: bool,
    },
    /// Show status of a run
    Status {
        run_id: String,
        #[arg(long)]
        attempt: Option<u32>,
    },
    /// Wait for a run to reach a terminal state
    Wait {
        run_id: String,
        #[arg(long)]
        attempt: Option<u32>,
        #[arg(long, default_value = "2")]
        poll_interval: u64,
        #[arg(long)]
        timeout: Option<u64>,
    },
    /// Restart a run
    Restart {
        run_id: String,
        #[arg(long)]
        attempt: Option<u32>,
        #[arg(long)]
        wait: bool,
        #[arg(long, default_value = "2")]
        poll_interval: u64,
    },
    /// Delete a run
    Delete {
        run_id: String,
        #[arg(long)]
        attempt: Option<u32>,
        #[arg(long)]
        yes: bool,
    },
    /// List available output datasets for a run
    OutputsList {
        run_id: String,
        #[arg(long)]
        attempt: Option<u32>,
    },
    /// Fetch an output dataset
    OutputsFetch {
        run_id: String,
        dataset_id: String,
        #[arg(long)]
        attempt: Option<u32>,
        #[arg(long, short)]
        output: Option<std::path::PathBuf>,
        #[arg(long)]
        stdout: bool,
    },
    /// Download run logs as a zip archive
    LogsDownload {
        run_id: String,
        #[arg(long)]
        attempt: Option<u32>,
        #[arg(long, short)]
        output: Option<std::path::PathBuf>,
    },
}

// Schedule

#[derive(Args, Debug)]
pub struct ScheduleArgs {
    #[command(subcommand)]
    pub cmd: ScheduleCmd,
}

#[derive(Subcommand, Debug)]
pub enum ScheduleCmd {
    /// List schedules
    List {
        #[arg(long, default_value = "1")]
        page: u32,
        #[arg(long, default_value = "10")]
        page_size: u32,
        #[arg(long)]
        all: bool,
    },
    /// Show a single schedule
    Show { schedule_id: String },
    /// Create a new cron schedule from an existing workflow
    Create {
        #[arg(long)]
        workflow_id: String,
        #[arg(long)]
        workflow_version: Option<u32>,
        #[arg(long)]
        cron: String,
        #[arg(long, default_value = "24")]
        max_acceptable_delay_hours: u32,
        #[arg(long)]
        first_run_override: Option<String>,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        description: Option<String>,
        #[arg(long = "tag")]
        tags: Vec<String>,
    },
    /// Update mutable schedule fields
    Update {
        schedule_id: String,
        #[arg(long)]
        version: Option<u32>,
        #[arg(long)]
        cron: Option<String>,
        #[arg(long, conflicts_with = "disable")]
        enable: bool,
        #[arg(long, conflicts_with = "enable")]
        disable: bool,
        #[arg(long)]
        max_acceptable_delay_hours: Option<u32>,
        #[arg(long)]
        first_run_override: Option<String>,
    },
    /// Delete a schedule
    Delete {
        schedule_id: String,
        #[arg(long)]
        version: Option<u32>,
    },
    /// List runs associated with a schedule
    Runs {
        schedule_id: String,
        #[arg(long, default_value = "1")]
        page: u32,
        #[arg(long, default_value = "10")]
        page_size: u32,
        #[arg(long)]
        all: bool,
    },
    /// Show the next scheduled execution time
    Next { schedule_id: String },
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

#[derive(Args, Debug)]
pub struct SchedulerArgs {
    #[command(subcommand)]
    pub cmd: SchedulerCmd,
}

#[derive(Subcommand, Debug)]
pub enum SchedulerCmd {
    /// Show current scheduler time
    Time,
    /// Restart the backend scheduler thread [admin only]
    Restart,
}
