use std::collections::HashMap;
use std::path::PathBuf;

use fiab_client::ClientConfig;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize, Default)]
pub struct ProfileConfig {
    pub server_url: Option<String>,
    pub auth_token: Option<String>,
    pub request_timeout_seconds: Option<u64>,
    pub poll_interval_seconds: Option<u64>,
}

#[derive(Debug, Deserialize, Serialize, Default)]
pub struct FileConfig {
    #[serde(default)]
    pub profiles: HashMap<String, ProfileConfig>,
}

pub fn config_file_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("fiab")
        .join("config.toml")
}

fn load_profile(profile: &str) -> ProfileConfig {
    let path = config_file_path();
    if !path.exists() {
        return ProfileConfig::default();
    }
    let content = std::fs::read_to_string(&path).unwrap_or_default();
    let config: FileConfig = toml::from_str(&content).unwrap_or_default();
    config.profiles.into_values().next().unwrap_or_default();
    // Actually look up the named profile
    let mut parsed: FileConfig = toml::from_str(
        &std::fs::read_to_string(&path).unwrap_or_default(),
    )
    .unwrap_or_default();
    parsed.profiles.remove(profile).unwrap_or_default()
}

pub fn build_client_config(
    server_url_flag: Option<String>,
    profile: &str,
    timeout_flag: Option<u64>,
) -> ClientConfig {
    let p = load_profile(profile);

    let server_url = server_url_flag
        .or_else(|| std::env::var("FIAB_SERVER_URL").ok())
        .or(p.server_url)
        .unwrap_or_else(|| "http://localhost:8000".to_string());

    let auth_token = std::env::var("FIAB_AUTH_TOKEN")
        .ok()
        .or(p.auth_token)
        .filter(|s| !s.is_empty());

    let timeout_seconds = timeout_flag.or(p.request_timeout_seconds).unwrap_or(30);
    let poll_interval_seconds = p.poll_interval_seconds.unwrap_or(2);

    ClientConfig {
        server_url,
        auth_token,
        timeout_seconds,
        poll_interval_seconds,
    }
}
