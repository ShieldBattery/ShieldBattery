use crate::email::MailgunSettings;
use color_eyre::eyre;
use color_eyre::eyre::{WrapErr, eyre};
use reqwest::Url;
use secrecy::{ExposeSecret, SecretString};
use serde::Deserialize;
use std::time::Duration;

/// The environment the application is running in.
#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash)]
pub enum Env {
    Local,
    Test,
    Production,
}

#[derive(Debug, Clone)]
pub struct Settings {
    pub env: Env,
    pub app_host: String,
    pub app_port: u16,
    pub database: DatabaseSettings,
    pub redis: RedisSettings,
    pub mailgun: Option<MailgunSettings>,
    pub canonical_host: String,
    pub reverse_proxied: bool,
    pub datadog_api_key: Option<SecretString>,
    pub jwt_secret: SecretString,
    pub session_ttl: Duration,
    pub file_store: FileStoreSettings,
    /// Twitch integration credentials. `None` disables the integration entirely (account linking
    /// errors out and the live-streams feed stays empty), so dev/CI can run without Twitch creds.
    pub twitch: Option<TwitchSettings>,
}

#[derive(Debug, Clone)]
pub struct TwitchSettings {
    /// The OAuth client ID of our registered Twitch application. Public (embedded in authorize
    /// URLs the client opens), so it's a plain String.
    pub client_id: String,
    /// The OAuth client secret of our registered Twitch application. Only ever used server-side for
    /// the authorization-code token exchange and app (client-credentials) token.
    pub client_secret: SecretString,
    /// The secret we hand to Twitch when creating EventSub subscriptions and use to verify the HMAC
    /// signature on incoming webhook notifications. Must stay stable across restarts (it's shared
    /// with Twitch), so it's configured rather than generated.
    pub eventsub_secret: SecretString,
}

#[derive(Debug, Clone)]
pub struct DatabaseSettings {
    pub user: String,
    password: SecretString,
    /// Super password, only used for maintenance tasks so it will not generally be passed to
    /// production servers.
    super_password: Option<SecretString>,
    pub host: String,
    pub port: String,
    pub database_name: String,
}

#[derive(Debug, Clone)]
pub struct RedisSettings {
    pub host: String,
    pub port: String,
}

impl DatabaseSettings {
    pub fn connection_string(&self) -> SecretString {
        format!(
            "postgres://{}:{}@{}:{}/{}",
            &self.user,
            &self.password.expose_secret(),
            &self.host,
            &self.port,
            &self.database_name
        )
        .into()
    }

    pub fn connection_string_super_without_db(&self) -> SecretString {
        format!(
            "postgres://postgres:{}@{}:{}",
            &self.super_password.clone().unwrap().expose_secret(),
            &self.host,
            &self.port
        )
        .into()
    }

    pub fn connection_string_super(&self) -> SecretString {
        format!(
            "postgres://postgres:{}@{}:{}/{}",
            &self.super_password.clone().unwrap().expose_secret(),
            &self.host,
            &self.port,
            &self.database_name
        )
        .into()
    }
}

#[derive(Debug, Clone, Deserialize)]
pub enum FileStoreSettings {
    #[serde(rename = "filesystem")]
    Local(LocalFileStoreSettings),
    #[serde(rename = "doSpaces")]
    Spaces(SpacesFileStoreSettings),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileStoreSettings {
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpacesFileStoreSettings {
    pub bucket: String,
    pub endpoint: String,
    pub access_key_id: String,
    pub secret_access_key: SecretString,
    pub cdn_host: Option<String>,
    pub region: Option<String>,
}

pub fn get_configuration() -> eyre::Result<Settings> {
    #[cfg(test)]
    let env = Env::Test;
    #[cfg(all(not(test), debug_assertions))]
    let env = Env::Local;
    #[cfg(not(any(test, debug_assertions)))]
    let env = Env::Production;

    let host = std::env::var("SB_GQL_HOST").unwrap_or("127.0.0.1".to_string());
    let port = std::env::var("SB_GQL_PORT").unwrap_or("5556".to_string());

    let mailgun_key = std::env::var("SB_MAILGUN_KEY").ok();
    let mailgun_domain = std::env::var("SB_MAILGUN_DOMAIN").ok();
    let mailgun_from = std::env::var("SB_MAILGUN_FROM").ok();

    if mailgun_key.is_some() != mailgun_domain.is_some()
        || mailgun_key.is_some() != mailgun_from.is_some()
    {
        return Err(eyre!(
            "SB_MAILGUN_KEY, SB_MAILGUN_DOMAIN, and SB_MAILGUN_FROM must all be set or all unset"
        ));
    }

    let mailgun_url = std::env::var("SB_MAILGUN_URL")
        .ok()
        .map(|s| s.parse::<Url>().wrap_err("Failed to parse SB_MAILGUN_URL"))
        .transpose()?;

    let mailgun = mailgun_key.map(|key| {
        MailgunSettings::new(
            key,
            mailgun_domain.unwrap(),
            mailgun_from.unwrap(),
            mailgun_url,
        )
    });

    let file_store = std::env::var("SB_FILE_STORE")
        .wrap_err("Failed to read SB_FILE_STORE")
        .and_then(|s| {
            println!("SB_FILE_STORE: {s}");
            serde_json::from_str::<FileStoreSettings>(&s)
                .wrap_err("Failed to parse SB_FILE_STORE JSON")
        })?;

    let twitch_client_id = std::env::var("SB_TWITCH_CLIENT_ID").ok();
    let twitch_client_secret = std::env::var("SB_TWITCH_CLIENT_SECRET").ok();
    let twitch_eventsub_secret = std::env::var("SB_TWITCH_EVENTSUB_SECRET").ok();
    if twitch_client_id.is_some() != twitch_client_secret.is_some()
        || twitch_client_id.is_some() != twitch_eventsub_secret.is_some()
    {
        return Err(eyre!(
            "SB_TWITCH_CLIENT_ID, SB_TWITCH_CLIENT_SECRET, and SB_TWITCH_EVENTSUB_SECRET must all \
             be set or all unset"
        ));
    }
    let twitch = twitch_client_id.map(|client_id| TwitchSettings {
        client_id,
        client_secret: twitch_client_secret.unwrap().into(),
        eventsub_secret: twitch_eventsub_secret.unwrap().into(),
    });

    Ok(Settings {
        env,
        app_host: host,
        app_port: port.parse()?,
        database: DatabaseSettings {
            user: std::env::var("SB_DB_USER").wrap_err("SB_DB_USER is not set")?,
            password: std::env::var("SB_DB_PASSWORD")
                .wrap_err("SB_DB_PASSWORD is not set")?
                .into(),
            super_password: std::env::var("POSTGRES_SUPER_PASSWORD")
                .ok()
                .map(Into::into),
            host: std::env::var("SB_DB_HOST").wrap_err("SB_DB_HOST is not set")?,
            port: std::env::var("SB_DB_PORT").wrap_err("SB_DB_PORT is not set")?,
            database_name: std::env::var("SB_DB").wrap_err("SB_DB is not set")?,
        },
        redis: RedisSettings {
            host: std::env::var("SB_REDIS_HOST").wrap_err("SB_REDIS_HOST is not set")?,
            port: std::env::var("SB_REDIS_PORT").wrap_err("SB_REDIS_PORT is not set")?,
        },
        mailgun,
        canonical_host: std::env::var("SB_CANONICAL_HOST")
            .wrap_err("SB_CANONICAL_HOST is not set")?,
        reverse_proxied: std::env::var("SB_HTTPS_REVERSE_PROXY")
            .unwrap_or("false".into())
            .eq_ignore_ascii_case("true"),
        datadog_api_key: std::env::var("SB_DATADOG_KEY").ok().map(Into::into),
        jwt_secret: std::env::var("SB_JWT_SECRET")
            .wrap_err("SB_JWT_SECRET is not set")?
            .into(),
        session_ttl: Duration::from_secs(
            std::env::var("SB_SESSION_TTL")
                .wrap_err("SB_SESSION_TTL is not set")?
                .parse()
                .wrap_err("SB_SESSION_TTL is not a valid integer")?,
        ),
        file_store,
        twitch,
    })
}
