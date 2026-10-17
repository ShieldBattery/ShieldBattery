use std::{
    io::ErrorKind,
    path::{Component, Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use aws_config::{BehaviorVersion, Region};
use aws_sdk_s3::{
    config::Credentials, presigning::PresigningConfig, primitives::ByteStream,
    types::ObjectCannedAcl,
};
use color_eyre::eyre::{self, Context as _, bail};
use secrecy::ExposeSecret;
use url::Url;

use crate::configuration::SpacesFileStoreSettings;

/// How long browsers can cache stored files by default (in seconds). Stored files are expected to
/// be effectively immutable, so this can be long.
const FILE_MAX_AGE_SECONDS: u64 = 14 * 24 * 60 * 60;

/// Options for writing a file to a [`FileStore`]. Stores that have no notion of a given option
/// (e.g. the local store has no content types or ACLs) ignore it.
#[derive(Debug, Clone, Default)]
pub struct WriteOptions {
    /// The `Content-Type` the file should be served with.
    pub content_type: Option<String>,
    /// Whether the file should be readable by anyone with its URL (rather than only via signed
    /// URLs).
    pub public: bool,
    /// The `Cache-Control` the file should be served with. Defaults to a two week `max-age`.
    pub cache_control: Option<String>,
}

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

    /// Returns a signed URL that, when fetched, downloads the file as an attachment with the given
    /// `download_filename` (via `Content-Disposition`) rather than serving it inline under its
    /// storage key.
    pub async fn signed_url_with_disposition(
        &self,
        filename: &str,
        download_filename: &str,
        expires_in: Duration,
    ) -> eyre::Result<String> {
        match self {
            FileStore::Local(store) => {
                store
                    .signed_url_with_disposition(filename, download_filename, expires_in)
                    .await
            }
            FileStore::Spaces(store) => {
                store
                    .signed_url_with_disposition(filename, download_filename, expires_in)
                    .await
            }
        }
    }

    /// Writes `data` to `filename`, replacing any existing file. Local writes are atomic: readers
    /// see either the old contents or the new contents, never a partial file.
    pub async fn write(
        &self,
        filename: &str,
        data: Vec<u8>,
        options: &WriteOptions,
    ) -> eyre::Result<()> {
        match self {
            FileStore::Local(store) => store.write(filename, data, options).await,
            FileStore::Spaces(store) => store.write(filename, data, options).await,
        }
    }

    /// Reads the entire contents of `filename`.
    pub async fn read(&self, filename: &str) -> eyre::Result<Vec<u8>> {
        match self {
            FileStore::Local(store) => store.read(filename).await,
            FileStore::Spaces(store) => store.read(filename).await,
        }
    }

    /// Deletes `filename`. Deleting a file that doesn't exist is not an error.
    pub async fn delete(&self, filename: &str) -> eyre::Result<()> {
        match self {
            FileStore::Local(store) => store.delete(filename).await,
            FileStore::Spaces(store) => store.delete(filename).await,
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
    async fn signed_url_with_disposition(
        &self,
        filename: &str,
        download_filename: &str,
        expires_in: Duration,
    ) -> eyre::Result<String>;
    async fn write(
        &self,
        filename: &str,
        data: Vec<u8>,
        options: &WriteOptions,
    ) -> eyre::Result<()>;
    async fn read(&self, filename: &str) -> eyre::Result<Vec<u8>>;
    async fn delete(&self, filename: &str) -> eyre::Result<()>;
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
        std::fs::create_dir_all(&path).wrap_err("Failed to create LocalFileStore path")?;
        path.canonicalize()
            .map(|path| Self {
                path,
                canonical_host,
                start_instant: Instant::now(),
            })
            .wrap_err("Invalid LocalFileStore path")
    }

    /// Returns the full path to a file, combining it with this file store's base path. The file
    /// does not need to exist. Absolute paths, drive prefixes and `..` components are rejected, so
    /// the result is always a descendant of the base path.
    fn get_full_path(&self, filename: &str) -> eyre::Result<PathBuf> {
        let mut full_path = self.path.clone();
        let mut has_component = false;
        for component in Path::new(filename).components() {
            match component {
                Component::Normal(part) => {
                    full_path.push(part);
                    has_component = true;
                }
                Component::CurDir => {}
                Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                    bail!("Invalid file path: path escapes the file store root");
                }
            }
        }
        if !has_component {
            bail!("Invalid file path: path is empty");
        }

        Ok(full_path)
    }

    fn normalize_path(&self, filename: &str) -> eyre::Result<String> {
        let normalized = Path::new(filename).components().collect::<PathBuf>();

        // Ensure the path is not absolute and does not start with a dot
        if normalized.is_absolute() || filename.starts_with('.') {
            bail!(
                "Invalid file path: absolute paths or paths starting with directory traversal are disallowed"
            );
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

    async fn signed_url_with_disposition(
        &self,
        filename: &str,
        _download_filename: &str,
        _expires_in: Duration,
    ) -> eyre::Result<String> {
        // The dev file store can't set response headers; the filename is only cosmetic here.
        self.signed_url(filename).await
    }

    async fn write(
        &self,
        filename: &str,
        data: Vec<u8>,
        _options: &WriteOptions,
    ) -> eyre::Result<()> {
        let full_path = self.get_full_path(filename)?;
        let parent = full_path
            .parent()
            .ok_or_else(|| eyre::eyre!("Invalid file path: no parent directory"))?;
        tokio::fs::create_dir_all(parent)
            .await
            .wrap_err("Failed to create directory for file")?;

        // Write to a sibling temp file and rename it into place so readers never observe a
        // partially written file.
        static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);
        let file_name = full_path.file_name().unwrap_or_default().to_string_lossy();
        let temp_path = parent.join(format!(
            ".{file_name}.{}.{}.tmp",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed),
        ));
        tokio::fs::write(&temp_path, data)
            .await
            .wrap_err("Failed to write file")?;
        if let Err(err) = tokio::fs::rename(&temp_path, &full_path).await {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(err).wrap_err("Failed to move file into place");
        }

        Ok(())
    }

    async fn read(&self, filename: &str) -> eyre::Result<Vec<u8>> {
        let full_path = self.get_full_path(filename)?;
        tokio::fs::read(&full_path)
            .await
            .wrap_err("Failed to read file")
    }

    async fn delete(&self, filename: &str) -> eyre::Result<()> {
        let full_path = self.get_full_path(filename)?;
        match tokio::fs::remove_file(&full_path).await {
            Ok(()) => Ok(()),
            Err(err) if err.kind() == ErrorKind::NotFound => Ok(()),
            Err(err) => Err(err).wrap_err("Failed to delete file"),
        }
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
            bail!(
                "Invalid file path: absolute paths or paths starting with directory traversal are disallowed"
            );
        }

        // Force posix path separators on aws-compatible services which use them to create faux
        // folders
        let posix_path = normalized.to_string_lossy().replace('\\', "/");
        Ok(posix_path)
    }
}

async fn create_aws_config(settings: SpacesFileStoreSettings) -> eyre::Result<aws_sdk_s3::Config> {
    let sdk_config = aws_config::load_defaults(BehaviorVersion::v2026_01_12()).await;
    let mut s3_config = aws_sdk_s3::config::Builder::from(&sdk_config);

    // The S3 SDK refuses to build/sign requests without a region, even for providers like DO
    // Spaces where the endpoint alone determines routing, so fall back to a placeholder when the
    // config doesn't specify one (matching the Node server's behavior).
    let region = settings.region.unwrap_or_else(|| "us-east-1".to_string());
    s3_config.set_region(Some(Region::new(region)));
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

    async fn signed_url_with_disposition(
        &self,
        filename: &str,
        download_filename: &str,
        expires_in: Duration,
    ) -> eyre::Result<String> {
        let normalized = self.normalize_path(filename)?;
        let req = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(&normalized)
            .response_content_disposition(format!("attachment; filename=\"{download_filename}\""))
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

    async fn write(
        &self,
        filename: &str,
        data: Vec<u8>,
        options: &WriteOptions,
    ) -> eyre::Result<()> {
        let normalized = self.normalize_path(filename)?;
        let cache_control = options
            .cache_control
            .clone()
            .unwrap_or_else(|| format!("max-age={FILE_MAX_AGE_SECONDS}"));
        let mut req = self
            .client
            .put_object()
            .bucket(&self.bucket)
            .key(&normalized)
            .body(ByteStream::from(data))
            .cache_control(cache_control);
        if let Some(content_type) = &options.content_type {
            req = req.content_type(content_type);
        }
        if options.public {
            req = req.acl(ObjectCannedAcl::PublicRead);
        }
        req.send().await.wrap_err("Failed to upload file")?;

        Ok(())
    }

    async fn read(&self, filename: &str) -> eyre::Result<Vec<u8>> {
        let normalized = self.normalize_path(filename)?;
        let output = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(&normalized)
            .send()
            .await
            .wrap_err("Failed to download file")?;
        let bytes = output
            .body
            .collect()
            .await
            .wrap_err("Failed to read file body")?;

        Ok(bytes.to_vec())
    }

    async fn delete(&self, filename: &str) -> eyre::Result<()> {
        let normalized = self.normalize_path(filename)?;
        // S3 deletes are idempotent: deleting a missing key succeeds.
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(&normalized)
            .send()
            .await
            .wrap_err("Failed to delete file")?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new() -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            Self(
                std::env::temp_dir()
                    .join(format!(
                        "sb-file-store-test-{}-{}",
                        std::process::id(),
                        COUNTER.fetch_add(1, Ordering::Relaxed),
                    ))
                    .join("root"),
            )
        }

        fn store(&self) -> LocalFileStore {
            let path = self.0.to_str().expect("temp dir is valid UTF-8");
            LocalFileStore::new(path, "http://localhost".to_string()).unwrap()
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            if let Some(parent) = self.0.parent() {
                let _ = std::fs::remove_dir_all(parent);
            }
        }
    }

    #[test]
    fn new_creates_missing_root() {
        let root = TempRoot::new();
        assert!(!root.0.exists());
        root.store();
        assert!(root.0.is_dir());
    }

    #[tokio::test]
    async fn write_read_round_trip() {
        let root = TempRoot::new();
        let store = root.store();
        let opts = WriteOptions::default();
        store.write("a.bin", vec![1, 2, 3], &opts).await.unwrap();
        assert_eq!(store.read("a.bin").await.unwrap(), vec![1, 2, 3]);
    }

    #[tokio::test]
    async fn write_creates_nested_dirs_and_leaves_no_temp_files() {
        let root = TempRoot::new();
        let store = root.store();
        let opts = WriteOptions::default();
        store
            .write("a/b/c.txt", b"hi".to_vec(), &opts)
            .await
            .unwrap();
        assert_eq!(store.read("a/b/c.txt").await.unwrap(), b"hi");
        let entries = std::fs::read_dir(store.path.join("a/b")).unwrap().count();
        assert_eq!(entries, 1);
    }

    #[tokio::test]
    async fn write_overwrites() {
        let root = TempRoot::new();
        let store = root.store();
        let opts = WriteOptions::default();
        store.write("f", b"one".to_vec(), &opts).await.unwrap();
        store.write("f", b"two".to_vec(), &opts).await.unwrap();
        assert_eq!(store.read("f").await.unwrap(), b"two");
    }

    #[tokio::test]
    async fn delete_removes_file_and_tolerates_missing() {
        let root = TempRoot::new();
        let store = root.store();
        let opts = WriteOptions::default();
        store.write("f", b"x".to_vec(), &opts).await.unwrap();
        store.delete("f").await.unwrap();
        assert!(store.read("f").await.is_err());
        store.delete("f").await.unwrap();
        store.delete("never/existed").await.unwrap();
    }

    #[tokio::test]
    async fn read_missing_file_errors() {
        let root = TempRoot::new();
        assert!(root.store().read("missing").await.is_err());
    }

    #[tokio::test]
    async fn rejects_traversal_and_absolute_paths() {
        let root = TempRoot::new();
        let store = root.store();
        let opts = WriteOptions::default();
        let absolute = std::env::temp_dir().join("sb-escape.txt");
        let absolute = absolute.to_str().unwrap();
        for bad in [
            "../x",
            "a/../../x",
            "a/..",
            "",
            ".",
            absolute,
            "/etc/passwd",
        ] {
            assert!(store.write(bad, vec![0], &opts).await.is_err(), "{bad}");
            assert!(store.read(bad).await.is_err(), "{bad}");
            assert!(store.delete(bad).await.is_err(), "{bad}");
        }
        assert!(!root.0.parent().unwrap().join("x").exists());
    }
}
