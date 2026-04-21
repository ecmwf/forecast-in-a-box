use comfy_table::{Cell, Table};
use fiab_lib_client::models::{
    run::RunDetailResponse,
    schedule::{NextRunResponse, ScheduleDetail},
    status::StatusResponse,
    workflow::WorkflowDetail,
};

pub fn render_status(s: &StatusResponse, json: bool) {
    if json {
        println!("{}", serde_json::to_string_pretty(s).unwrap());
        return;
    }
    println!("api:       {}", s.api);
    println!("cascade:   {}", s.cascade);
    println!("ecmwf:     {}", s.ecmwf);
    println!("scheduler: {}", s.scheduler);
    println!("version:   {}", s.version);
    println!("plugins:   {}", s.plugins);
}

pub fn render_workflow_list(workflows: &[WorkflowDetail], json: bool) {
    if json {
        println!("{}", serde_json::to_string_pretty(workflows).unwrap());
        return;
    }
    let mut table = Table::new();
    table.set_header(vec!["ID", "Version", "Name", "Tags"]);
    for w in workflows {
        table.add_row(vec![
            Cell::new(&w.blueprint_id),
            Cell::new(w.version.to_string()),
            Cell::new(w.display_name.as_deref().unwrap_or("-")),
            Cell::new(w.tags.as_ref().map(|t| t.join(", ")).as_deref().unwrap_or("-")),
        ]);
    }
    println!("{table}");
}

pub fn render_workflow_detail(w: &WorkflowDetail, json: bool) {
    if json {
        println!("{}", serde_json::to_string_pretty(w).unwrap());
        return;
    }
    println!("blueprint_id:        {}", w.blueprint_id);
    println!("version:             {}", w.version);
    println!("display_name:        {}", w.display_name.as_deref().unwrap_or("-"));
    println!("display_description: {}", w.display_description.as_deref().unwrap_or("-"));
    println!("tags:                {}", w.tags.as_ref().map(|t| t.join(", ")).as_deref().unwrap_or("-"));
    println!("parent_id:           {}", w.parent_id.as_deref().unwrap_or("-"));
    println!("created_by:          {}", w.created_by.as_deref().unwrap_or("-"));
}

pub fn render_run_list(runs: &[RunDetailResponse], json: bool) {
    if json {
        println!("{}", serde_json::to_string_pretty(runs).unwrap());
        return;
    }
    let mut table = Table::new();
    table.set_header(vec!["Run ID", "Attempt", "Status", "Workflow", "Created At"]);
    for r in runs {
        table.add_row(vec![
            Cell::new(&r.run_id),
            Cell::new(r.attempt_count.to_string()),
            Cell::new(&r.status),
            Cell::new(&r.blueprint_id),
            Cell::new(&r.created_at),
        ]);
    }
    println!("{table}");
}

pub fn render_run_detail(r: &RunDetailResponse, json: bool) {
    if json {
        println!("{}", serde_json::to_string_pretty(r).unwrap());
        return;
    }
    println!("run_id:            {}", r.run_id);
    println!("attempt_count:     {}", r.attempt_count);
    println!("status:            {}", r.status);
    println!("blueprint_id:      {}", r.blueprint_id);
    println!("blueprint_version: {}", r.blueprint_version);
    println!("created_at:        {}", r.created_at);
    println!("updated_at:        {}", r.updated_at);
    if let Some(ref e) = r.error {
        println!("error:             {}", e);
    }
    if let Some(ref p) = r.progress {
        println!("progress:          {}", p);
    }
    if let Some(ref c) = r.cascade_job_id {
        println!("cascade_job_id:    {}", c);
    }
}

pub fn render_schedule_list(schedules: &[ScheduleDetail], json: bool) {
    if json {
        println!("{}", serde_json::to_string_pretty(schedules).unwrap());
        return;
    }
    let mut table = Table::new();
    table.set_header(vec!["ID", "Version", "Workflow", "Cron", "Enabled", "Name"]);
    for s in schedules {
        table.add_row(vec![
            Cell::new(&s.experiment_id),
            Cell::new(s.experiment_version.to_string()),
            Cell::new(&s.blueprint_id),
            Cell::new(&s.cron_expr),
            Cell::new(if s.enabled { "yes" } else { "no" }),
            Cell::new(s.display_name.as_deref().unwrap_or("-")),
        ]);
    }
    println!("{table}");
}

pub fn render_schedule_detail(s: &ScheduleDetail, json: bool) {
    if json {
        println!("{}", serde_json::to_string_pretty(s).unwrap());
        return;
    }
    println!("experiment_id:          {}", s.experiment_id);
    println!("experiment_version:     {}", s.experiment_version);
    println!("blueprint_id:           {}", s.blueprint_id);
    println!("blueprint_version:      {}", s.blueprint_version);
    println!("cron_expr:              {}", s.cron_expr);
    println!("max_acceptable_delay_h: {}", s.max_acceptable_delay_hours);
    println!("enabled:                {}", s.enabled);
    println!("created_at:             {}", s.created_at);
    println!("created_by:             {}", s.created_by.as_deref().unwrap_or("-"));
    println!("display_name:           {}", s.display_name.as_deref().unwrap_or("-"));
    println!("display_description:    {}", s.display_description.as_deref().unwrap_or("-"));
    println!("tags:                   {}", s.tags.as_ref().map(|t| t.join(", ")).as_deref().unwrap_or("-"));
}

pub fn render_next_run(r: &NextRunResponse, json: bool) {
    match r {
        NextRunResponse::Scheduled(t) => {
            if json {
                println!("{}", serde_json::json!({ "next_run": t }));
            } else {
                println!("Next run: {}", t);
            }
        }
        NextRunResponse::NotScheduled => {
            if json {
                println!("{}", serde_json::json!({ "next_run": null }));
            } else {
                println!("Not scheduled currently");
            }
        }
        NextRunResponse::Unknown(s) => {
            if json {
                println!("{}", serde_json::json!({ "next_run": s }));
            } else {
                println!("Unknown: {}", s);
            }
        }
    }
}

pub fn render_string_list(items: &[String], json: bool) {
    if json {
        println!("{}", serde_json::to_string_pretty(items).unwrap());
        return;
    }
    for item in items {
        println!("{}", item);
    }
}
