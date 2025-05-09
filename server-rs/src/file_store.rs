use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

use aws_config::{BehaviorVersion, Region};
use aws_sdk_s3::{config::Credentials, presigning::PresigningConfig};
use color_eyre::eyre::{self, bail, Context as _};
use secrecy::ExposeSecret;
use url::Url;

use crate::configuration::SpacesFileStoreSettings;

#[derive(Debug, Clone)]
pub enum FileStore {
    Local(Arc<LocalFileStore>),
    Spaces(Arc<SpacesFileStore>),
}

impl FileStore {
    pub fn url(&self, filename: &str) -> eyre::Result<String> {
        match self {
            FileStore::Local(store) => store.url(filename),
            FileStore::Spaces(store) => store.url(filename),
        }
    }

    pub async fn signed_url(&self, filename: &str) -> eyre::Result<String> {
        match self {
            FileStore::Local(store) => store.signed_url(filename).await,
            FileStore::Spaces(store) => store.signed_url(filename).await,
        }
    }

    pub async fn signed_url_with_expiry(
        &self,
        filename: &str,
        expires_in: Duration,
    ) -> eyre::Result<String> {
        match self {
            FileStore::Local(store) => store.signed_url_with_expiry(filename, expires_in).await,
            FileStore::Spaces(store) => store.signed_url_with_expiry(filename, expires_in).await,
        }
    }
}

trait FileStoreImpl {
    fn url(&self, filename: &str) -> eyre::Result<String>;
    async fn signed_url(&self, filename: &str) -> eyre::Result<String>;
    async fn signed_url_with_expiry(
        &self,
        filename: &str,
        expires_in: Duration,
    ) -> eyre::Result<String>;
}

pub async fn file_store_from_config(
    config: &crate::configuration::Settings,
) -> eyre::Result<FileStore> {
    match config.file_store {
        crate::configuration::FileStoreSettings::Local(ref settings) => {
            let store = LocalFileStore::new(&settings.path, config.canonical_host.clone())?;
            Ok(FileStore::Local(Arc::new(store)))
        }
        crate::configuration::FileStoreSettings::Spaces(ref settings) => {
            let store = SpacesFileStore::new(settings.clone()).await?;
            Ok(FileStore::Spaces(Arc::new(store)))
        }
    }
}

#[derive(Debug, Clone)]
pub struct LocalFileStore {
    #[allow(dead_code)]
    path: PathBuf,
    canonical_host: String,
    start_instant: Instant,
}

impl LocalFileStore {
    pub fn new(path: &str, canonical_host: String) -> eyre::Result<Self> {
        // NOTE(tec27): Our configuration was originally for the TS server which assumes a CWD of
        // the repo root, so we need to adjust the path to be relative to that. This server runs
        // with a CWD of `server-rs`, so we just traverse up one directory.
        let path = Path::new(path);
        let path = if path.is_absolute() {
            path.to_path_buf()
        } else {
            Path::new("../").join(path)
        };
        path.canonicalize()
            .map(|path| Self {
                path,
                canonical_host,
                start_instant: Instant::now(),
            })
            .wrap_err("Invalid LocalFileStore path")
    }

    /// Returns the full path to a file, combining it with this file store's base path and ensuring
    /// that the file is a descendant of the base path.
    #[allow(dead_code)]
    fn get_full_path(&self, filename: &str) -> eyre::Result<PathBuf> {
        let full_path = self.path.join(filename);
        let canonical = full_path
            .canonicalize()
            .wrap_err("Failed to canonicalize path")?;
        if !canonical.starts_with(&self.path) {
            bail!("Path traversal detected");
        }

        Ok(canonical)
    }

    fn normalize_path(&self, filename: &str) -> eyre::Result<String> {
        let normalized = Path::new(filename).components().collect::<PathBuf>();

        // Ensure the path is not absolute and does not start with a dot
        if normalized.is_absolute() || filename.starts_with('.') {
            bail!("Invalid file path: absolute paths or paths starting with directory traversal are disallowed");
        }

        Ok(normalized.to_string_lossy().into_owned())
    }

    fn normalize_url_path(&self, filename: &str) -> eyre::Result<String> {
        let normalized = self.normalize_path(filename)?;
        Ok(normalized.replace('\\', "/"))
    }
}

impl FileStoreImpl for LocalFileStore {
    fn url(&self, filename: &str) -> eyre::Result<String> {
        Ok(format!(
            "{}/files/{}",
            self.canonical_host,
            self.normalize_url_path(filename)?,
        ))
    }

    async fn signed_url(&self, filename: &str) -> eyre::Result<String> {
        // NOTE(tec27): This just simulates the cache-busting properties of having a signed URL in
        // a dev environment, it provides no actual signature protection :)
        let signature = self.start_instant.elapsed().as_millis();
        Ok(format!(
            "{}/files/{}?sig={signature}",
            self.canonical_host,
            self.normalize_url_path(filename)?,
        ))
    }

    async fn signed_url_with_expiry(
        &self,
        filename: &str,
        _expires_in: Duration,
    ) -> eyre::Result<String> {
        self.signed_url(filename).await
    }
}

#[derive(Debug, Clone)]
pub struct SpacesFileStore {
    base_url: String,
    bucket: String,
    client: aws_sdk_s3::Client,
    cdn_host: Option<String>,
}

impl SpacesFileStore {
    pub async fn new(mut settings: SpacesFileStoreSettings) -> eyre::Result<Self> {
        // Ensure the endpoint has a protocol prefix
        let endpoint = if settings.endpoint.starts_with("http://")
            || settings.endpoint.starts_with("https://")
        {
            settings.endpoint
        } else {
            format!("https://{}", settings.endpoint)
        };

        // Parse the endpoint to extract the hostname
        let parsed_url = Url::parse(&endpoint).wrap_err("Invalid endpoint URL")?;
        let hostname = parsed_url
            .host_str()
            .ok_or_else(|| eyre::eyre!("Failed to extract hostname from endpoint"))?;

        settings.endpoint = endpoint;

        // Construct the base URL
        let base_url = format!("https://{}.{}", settings.bucket, hostname);
        let bucket = settings.bucket.clone();
        let cdn_host = settings.cdn_host.clone();

        let config = create_aws_config(settings).await?;

        Ok(Self {
            base_url,
            bucket,
            client: aws_sdk_s3::Client::from_conf(config),
            cdn_host,
        })
    }

    fn normalize_path(&self, filename: &str) -> eyre::Result<String> {
        let normalized = Path::new(filename).components().collect::<PathBuf>();

        // Ensure the path is not absolute and does not start with a dot
        if normalized.is_absolute() || filename.starts_with('.') {
            bail!("Invalid file path: absolute paths or paths starting with directory traversal are disallowed");
        }

        // Force posix path separators on aws-compatible services which use them to create faux
        // folders
        let posix_path = normalized.to_string_lossy().replace('\\', "/");
        Ok(posix_path)
    }
}

async fn create_aws_config(settings: SpacesFileStoreSettings) -> eyre::Result<aws_sdk_s3::Config> {
    let sdk_config = aws_config::load_defaults(BehaviorVersion::v2025_01_17()).await;
    let mut s3_config = aws_sdk_s3::config::Builder::from(&sdk_config);

    if let Some(region) = settings.region {
        s3_config.set_region(Some(Region::new(region)));
    }
    let credentials = Credentials::new(
        settings.access_key_id,
        settings.secret_access_key.expose_secret(),
        None,
        None,
        "SpacesFileStoreSettings",
    );

    Ok(s3_config
        .endpoint_url(settings.endpoint)
        .credentials_provider(credentials)
        .build())
}

impl FileStoreImpl for SpacesFileStore {
    fn url(&self, filename: &str) -> eyre::Result<String> {
        let normalized = self.normalize_path(filename)?;
        let url = format!("{}/{}", self.base_url, normalized);

        if let Some(cdn_host) = &self.cdn_host {
            let mut url = Url::parse(&url).wrap_err("Invalid URL")?;
            url.set_host(Some(cdn_host)).wrap_err("Invalid CDN host")?;
            Ok(url.to_string())
        } else {
            Ok(url)
        }
    }

    async fn signed_url(&self, filename: &str) -> eyre::Result<String> {
        self.signed_url_with_expiry(filename, Duration::from_secs(15 * 60))
            .await
    }

    async fn signed_url_with_expiry(
        &self,
        filename: &str,
        expires_in: Duration,
    ) -> eyre::Result<String> {
        let normalized = self.normalize_path(filename)?;
        let req = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(&normalized)
            .presigned(PresigningConfig::expires_in(expires_in)?)
            .await?;

        let url = req.uri();

        if let Some(cdn_host) = &self.cdn_host {
            let mut url = Url::parse(url).wrap_err("Invalid URL")?;
            url.set_host(Some(cdn_host)).wrap_err("Invalid CDN host")?;
            Ok(url.to_string())
        } else {
            Ok(url.to_owned())
        }
    }
}
