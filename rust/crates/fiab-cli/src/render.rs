use comfy_table::{Table, presets::UTF8_FULL_CONDENSED};
use fiab_client::models::{
    RunDetailResponse, ScheduleDetail, StatusResponse, WorkflowDetail,
};

pub fn print_status(s: &StatusResponse) {
    println!("api:       {}", s.api);
    println!("cascade:   {}", s.cascade);
    println!("ecmwf:     {}", s.ecmwf);
    println!("scheduler: {}", s.scheduler);
    println!("version:   {}", s.version);
    println!("plugins:   {}", s.plugins);
}

pub fn print_workflows(workflows: &[WorkflowDetail]) {
    let mut table = Table::new();
    table.load_preset(UTF8_FULL_CONDENSED);
    table.set_header(["Workflow ID", "Ver", "Name", "Tags", "Source", "Created By"]);
    for w in workflows {
        table.add_row([
            w.blueprint_id.as_str(),
            &w.version.to_string(),
            w.display_name.as_deref().unwrap_or("-"),
            &w.tags.as_ref().map(|t| t.join(", ")).unwrap_or_default(),
            w.source.as_deref().unwrap_or("-"),
            w.created_by.as_deref().unwrap_or("-"),
        ]);
    }
    println!("{table}");
}

pub fn print_workflow(w: &WorkflowDetail) {
    println!("Workflow ID:          {}", w.blueprint_id);
    println!("Version:              {}", w.version);
    println!("Name:                 {}", w.display_name.as_deref().unwrap_or("-"));
    println!("Description:          {}", w.display_description.as_deref().unwrap_or("-"));
    println!("Tags:                 {}", w.tags.as_ref().map(|t| t.join(", ")).unwrap_or_default());
    println!("Source:               {}", w.source.as_deref().unwrap_or("-"));
    println!("Created By:           {}", w.created_by.as_deref().unwrap_or("-"));
    println!("Parent ID:            {}", w.parent_id.as_deref().unwrap_or("-"));
}

pub fn print_runs(runs: &[RunDetailResponse]) {
    let mut table = Table::new();
    table.load_preset(UTF8_FULL_CONDENSED);
    table.set_header(["Run ID", "Attempt", "Status", "Workflow ID", "WF Ver", "Created At", "Updated At", "Cascade Job"]);
    for r in runs {
        table.add_row([
            r.run_id.as_str(),
            &r.attempt_count.to_string(),
            &r.status,
            &r.blueprint_id,
            &r.blueprint_version.to_string(),
            &r.created_at,
            &r.updated_at,
            r.cascade_job_id.as_deref().unwrap_or("-"),
        ]);
    }
    println!("{table}");
}

pub fn print_run(r: &RunDetailResponse) {
    println!("Run ID:         {}", r.run_id);
    println!("Attempt:        {}", r.attempt_count);
    println!("Status:         {}", r.status);
    println!("Created At:     {}", r.created_at);
    println!("Updated At:     {}", r.updated_at);
    println!("Workflow ID:    {}", r.blueprint_id);
    println!("WF Version:     {}", r.blueprint_version);
    println!("Progress:       {}", r.progress.as_deref().unwrap_or("-"));
    println!("Error:          {}", r.error.as_deref().unwrap_or("-"));
    println!("Cascade Job:    {}", r.cascade_job_id.as_deref().unwrap_or("-"));
}

pub fn print_schedules(schedules: &[ScheduleDetail]) {
    let mut table = Table::new();
    table.load_preset(UTF8_FULL_CONDENSED);
    table.set_header(["Schedule ID", "Ver", "Workflow ID", "WF Ver", "Cron", "Enabled", "Created At", "Created By", "Name"]);
    for s in schedules {
        table.add_row([
            s.experiment_id.as_str(),
            &s.experiment_version.to_string(),
            &s.blueprint_id,
            &s.blueprint_version.to_string(),
            &s.cron_expr,
            &s.enabled.to_string(),
            &s.created_at,
            s.created_by.as_deref().unwrap_or("-"),
            s.display_name.as_deref().unwrap_or("-"),
        ]);
    }
    println!("{table}");
}

pub fn print_schedule(s: &ScheduleDetail) {
    println!("Schedule ID:       {}", s.experiment_id);
    println!("Version:           {}", s.experiment_version);
    println!("Workflow ID:       {}", s.blueprint_id);
    println!("WF Version:        {}", s.blueprint_version);
    println!("Cron:              {}", s.cron_expr);
    println!("Max Delay (hrs):   {}", s.max_acceptable_delay_hours);
    println!("Enabled:           {}", s.enabled);
    println!("Created At:        {}", s.created_at);
    println!("Created By:        {}", s.created_by.as_deref().unwrap_or("-"));
    println!("Name:              {}", s.display_name.as_deref().unwrap_or("-"));
    println!("Description:       {}", s.display_description.as_deref().unwrap_or("-"));
    println!("Tags:              {}", s.tags.as_ref().map(|t| t.join(", ")).unwrap_or_default());
}
