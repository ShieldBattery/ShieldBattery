use crate::email::MailgunSettings;
use color_eyre::eyre;
use color_eyre::eyre::{eyre, WrapErr};
use reqwest::Url;
use secrecy::{ExposeSecret, Secret};

#[derive(Debug, Clone)]
pub struct Settings {
    pub app_host: String,
    pub app_port: u16,
    pub database: DatabaseSettings,
    pub redis: RedisSettings,
    pub mailgun: Option<MailgunSettings>,
    pub canonical_host: String,
    pub reverse_proxied: bool,
}

#[derive(Debug, Clone)]
pub struct DatabaseSettings {
    pub user: String,
    password: Secret<String>,
    /// Super password, only used for maintenance tasks so it will not generally be passed to
    /// production servers.
    super_password: Option<Secret<String>>,
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
    pub fn connection_string(&self) -> Secret<String> {
        Secret::new(format!(
            "postgres://{}:{}@{}:{}/{}",
            &self.user,
            &self.password.expose_secret(),
            &self.host,
            &self.port,
            &self.database_name
        ))
    }

    pub fn connection_string_super_without_db(&self) -> Secret<String> {
        Secret::new(format!(
            "postgres://postgres:{}@{}:{}",
            &self.super_password.clone().unwrap().expose_secret(),
            &self.host,
            &self.port
        ))
    }

    pub fn connection_string_super(&self) -> Secret<String> {
        Secret::new(format!(
            "postgres://postgres:{}@{}:{}/{}",
            &self.super_password.clone().unwrap().expose_secret(),
            &self.host,
            &self.port,
            &self.database_name
        ))
    }
}

pub fn get_configuration() -> eyre::Result<Settings> {
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

    Ok(Settings {
        app_host: host,
        app_port: port.parse()?,
        database: DatabaseSettings {
            user: std::env::var("SB_DB_USER").wrap_err("SB_DB_USER is not set")?,
            password: Secret::new(
                std::env::var("SB_DB_PASSWORD").wrap_err("SB_DB_PASSWORD is not set")?,
            ),
            super_password: std::env::var("POSTGRES_SUPER_PASSWORD")
                .ok()
                .map(Secret::new),
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
    })
}
