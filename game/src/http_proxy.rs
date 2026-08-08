//! HTTP proxy support for [`crate::http`].
//!
//! Proxy settings come from the standard `*_proxy` environment variables and, failing those, the
//! Windows system proxy (the "Internet Options" settings other Windows apps use). Users who need a
//! proxy configure it there, not through the environment, so both sources are needed for this to be
//! useful in practice.
//!
//! Reaching an `https` server through a proxy means tunneling: connect to the proxy, ask it to
//! `CONNECT host:port`, and run TLS inside the tunnel end-to-end with the real server. That's what
//! [`ProxyConnector`] does — it produces the byte stream, and the TLS layer wrapping it is none the
//! wiser. Plain `http` needs no tunnel: the connection goes to the proxy's own address and the
//! request carries an absolute URL to say what to forward it to — see [`ProxyStream`] for how that
//! request form gets selected.

use std::future::Future;
use std::io::{self, IoSlice};
use std::pin::Pin;
use std::sync::LazyLock;
use std::task::{Context, Poll};

use hyper::Uri;
use hyper_util::client::legacy::connect::{Connected, Connection, HttpConnector};
use hyper_util::rt::TokioIo;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf};
use tokio::net::TcpStream;
use tower_service::Service;

/// Ceiling on a proxy's `CONNECT` response headers, so a broken proxy that never sends the
/// terminating blank line can't make us read forever.
const MAX_CONNECT_RESPONSE_BYTES: usize = 8 * 1024;

/// Where requests should go, resolved once per process.
static CONFIG: LazyLock<ProxyConfig> = LazyLock::new(ProxyConfig::detect);

#[derive(Debug, Default)]
pub struct ProxyConfig {
    /// Proxy for `https` URLs, as `host:port`.
    https: Option<String>,
    /// Proxy for `http` URLs, as `host:port`.
    http: Option<String>,
    /// Host patterns that bypass the proxy. A leading `.` (or a bare domain) matches subdomains.
    bypass: Vec<String>,
}

impl ProxyConfig {
    fn detect() -> ProxyConfig {
        let mut config = ProxyConfig::from_env();
        if config.https.is_none() && config.http.is_none() {
            config = system_proxy().unwrap_or_default();
        }
        if config.https.is_some() || config.http.is_some() {
            debug!(
                "http proxy configured (https: {:?}, http: {:?}, bypass: {:?})",
                config.https, config.http, config.bypass
            );
        }
        config
    }

    fn from_env() -> ProxyConfig {
        let all = env_var("ALL_PROXY");
        ProxyConfig {
            https: env_var("HTTPS_PROXY")
                .or_else(|| all.clone())
                .as_deref()
                .and_then(host_port),
            http: env_var("HTTP_PROXY").or(all).as_deref().and_then(host_port),
            bypass: env_var("NO_PROXY")
                .map(|value| parse_bypass(&value))
                .unwrap_or_default(),
        }
    }

    /// The proxy to use for `uri`, or `None` to connect directly.
    fn proxy_for(&self, uri: &Uri) -> Option<&str> {
        let host = uri.host()?;
        if is_local(host) || self.is_bypassed(host) {
            return None;
        }
        match uri.scheme_str() {
            Some("https") => self.https.as_deref(),
            Some("http") => self.http.as_deref(),
            _ => None,
        }
    }

    fn is_bypassed(&self, host: &str) -> bool {
        self.bypass.iter().any(|pattern| {
            if pattern == "*" {
                return true;
            }
            let pattern = pattern.strip_prefix('.').unwrap_or(pattern);
            host.eq_ignore_ascii_case(pattern)
                || (host.len() > pattern.len()
                    && host.as_bytes()[host.len() - pattern.len() - 1] == b'.'
                    && host[host.len() - pattern.len()..].eq_ignore_ascii_case(pattern))
        })
    }
}

/// Loopback never goes through a proxy — notably the dev server, which no proxy would know how to
/// reach.
fn is_local(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host == "127.0.0.1"
        || host == "::1"
        || host == "[::1]"
}

fn env_var(name: &str) -> Option<String> {
    // Both spellings are conventional; the lowercase one wins where they disagree, matching what
    // other tools do.
    std::env::var(name.to_ascii_lowercase())
        .or_else(|_| std::env::var(name))
        .ok()
        .filter(|value| !value.trim().is_empty())
}

fn parse_bypass(value: &str) -> Vec<String> {
    value
        .split([',', ';'])
        .map(|entry| entry.trim())
        .filter(|entry| !entry.is_empty())
        .map(|entry| entry.to_ascii_lowercase())
        .collect()
}

/// Strips any scheme, credentials, and path from a proxy setting, leaving `host:port`.
///
/// Proxies are given in a lot of shapes (`http://host:8080`, `host:8080`, `http://user:pw@host`);
/// all that's needed to open the connection is the authority.
fn host_port(value: &str) -> Option<String> {
    let value = value.trim();
    let without_scheme = value.split_once("://").map_or(value, |(_, rest)| rest);
    let authority = without_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or(without_scheme);
    // Credentials aren't forwarded: this client doesn't do proxy authentication.
    let authority = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    if authority.is_empty() {
        return None;
    }
    Some(if authority.contains(':') {
        authority.to_string()
    } else {
        // Proxies are conventionally on 8080 when unspecified.
        format!("{authority}:8080")
    })
}

/// Reads the Windows system proxy settings, the ones configured through Internet Options.
///
/// Any failure (missing values, proxy disabled, unreadable key) means "no proxy" rather than an
/// error — a proxy setting we can't read is indistinguishable from not having one.
#[cfg(windows)]
fn system_proxy() -> Option<ProxyConfig> {
    use crate::windows::registry;

    const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";

    if registry::current_user_dword(KEY, "ProxyEnable").unwrap_or(0) == 0 {
        return None;
    }
    let server = registry::current_user_string(KEY, "ProxyServer")?;
    let bypass = registry::current_user_string(KEY, "ProxyOverride")
        .map(|value| {
            // Windows spells "bypass for local addresses" as this pseudo-entry; loopback already
            // bypasses unconditionally, so it needs no translation.
            parse_bypass(&value.replace("<local>", ""))
        })
        .unwrap_or_default();

    // ProxyServer is either a single `host:port` for everything, or per-scheme entries like
    // `http=host:80;https=host:443`.
    let mut config = ProxyConfig {
        bypass,
        ..Default::default()
    };
    if server.contains('=') {
        for entry in server.split(';') {
            match entry.split_once('=') {
                Some(("http", value)) => config.http = host_port(value),
                Some(("https", value)) => config.https = host_port(value),
                _ => {}
            }
        }
    } else {
        config.https = host_port(&server);
        config.http = config.https.clone();
    }
    Some(config)
}

#[cfg(not(windows))]
fn system_proxy() -> Option<ProxyConfig> {
    None
}

/// A TCP connection produced by [`ProxyConnector`], which additionally reports whether requests
/// written to it must use absolute-form request lines.
///
/// hyper's client chooses the request line's form from [`Connected::is_proxied`]: a forward proxy
/// handling a plain `http` request needs the absolute URL (`GET http://host/path HTTP/1.1`),
/// because the address that was dialed is the proxy's own and an origin-form path alone would not
/// say where to forward the request to. Direct connections and `CONNECT` tunnels both end at the
/// origin server, which expects origin-form, so only an untunneled connection to a proxy reports
/// itself as proxied.
pub struct ProxyStream {
    stream: TcpStream,
    proxied: bool,
}

impl ProxyStream {
    fn wrap(stream: TcpStream, proxied: bool) -> TokioIo<ProxyStream> {
        TokioIo::new(ProxyStream { stream, proxied })
    }
}

impl Connection for ProxyStream {
    fn connected(&self) -> Connected {
        self.stream.connected().proxy(self.proxied)
    }
}

impl AsyncRead for ProxyStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_read(cx, buf)
    }
}

impl AsyncWrite for ProxyStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.stream).poll_write(cx, buf)
    }

    fn poll_write_vectored(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bufs: &[IoSlice<'_>],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.stream).poll_write_vectored(cx, bufs)
    }

    fn is_write_vectored(&self) -> bool {
        self.stream.is_write_vectored()
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_shutdown(cx)
    }
}

/// Connector that opens a proxy tunnel when one is configured for the target, and connects
/// directly otherwise. Sits underneath the TLS connector, which treats either result the same.
#[derive(Clone)]
pub struct ProxyConnector {
    inner: HttpConnector,
}

impl ProxyConnector {
    pub fn new() -> ProxyConnector {
        let mut inner = HttpConnector::new();
        // The TLS layer above needs to see https URIs; without this the connector rejects them.
        inner.enforce_http(false);
        ProxyConnector { inner }
    }
}

impl Service<Uri> for ProxyConnector {
    type Response = TokioIo<ProxyStream>;
    type Error = Box<dyn std::error::Error + Send + Sync>;
    type Future =
        Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send + 'static>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx).map_err(Into::into)
    }

    fn call(&mut self, uri: Uri) -> Self::Future {
        let proxy = CONFIG.proxy_for(&uri).map(|proxy| proxy.to_string());
        let Some(proxy) = proxy else {
            let mut inner = self.inner.clone();
            return Box::pin(async move {
                let stream = inner.call(uri).await?;
                Ok(ProxyStream::wrap(stream.into_inner(), false))
            });
        };

        // A plain-http request through a proxy just goes to the proxy's address, with the absolute
        // URL in the request line saying where the proxy should forward it; no tunnel is needed.
        // https has to be tunneled so TLS terminates at the real server rather than the proxy.
        if uri.scheme_str() == Some("http") {
            let mut inner = self.inner.clone();
            let proxy_uri = match format!("http://{proxy}").parse::<Uri>() {
                Ok(uri) => uri,
                Err(err) => return Box::pin(async move { Err(err.into()) }),
            };
            return Box::pin(async move {
                let stream = inner.call(proxy_uri).await?;
                Ok(ProxyStream::wrap(stream.into_inner(), true))
            });
        }

        Box::pin(async move {
            let host = uri.host().ok_or("request url has no host")?;
            let port = uri.port_u16().unwrap_or(443);
            let stream = TcpStream::connect(&proxy).await?;
            let stream = connect_tunnel(stream, host, port).await?;
            Ok(ProxyStream::wrap(stream, false))
        })
    }
}

/// Performs the `CONNECT` handshake, leaving `stream` carrying raw bytes to `host:port`.
async fn connect_tunnel(
    mut stream: TcpStream,
    host: &str,
    port: u16,
) -> Result<TcpStream, Box<dyn std::error::Error + Send + Sync>> {
    let request = format!(
        "CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\nProxy-Connection: Keep-Alive\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).await?;
    stream.flush().await?;

    // Read until the headers terminate. The tunnel's payload can follow immediately in the same
    // read, so this stops at the blank line rather than reading to EOF — but a proxy replying 200
    // has nothing more to say until we speak, so anything past it would be a protocol violation.
    let mut response = Vec::new();
    let mut byte = [0u8; 1];
    while !response.ends_with(b"\r\n\r\n") {
        if response.len() >= MAX_CONNECT_RESPONSE_BYTES {
            return Err("proxy sent an oversized CONNECT response".into());
        }
        if stream.read(&mut byte).await? == 0 {
            return Err("proxy closed the connection during CONNECT".into());
        }
        response.push(byte[0]);
    }

    let status_line = response
        .split(|&b| b == b'\n')
        .next()
        .map(String::from_utf8_lossy)
        .unwrap_or_default()
        .trim()
        .to_string();
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| format!("proxy sent a malformed CONNECT response: {status_line:?}"))?;
    if !(200..300).contains(&status) {
        return Err(format!("proxy refused CONNECT with HTTP {status}").into());
    }
    Ok(stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(https: Option<&str>, bypass: &[&str]) -> ProxyConfig {
        ProxyConfig {
            https: https.map(|s| s.to_string()),
            http: None,
            bypass: bypass.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn host_port_accepts_the_shapes_proxies_are_written_in() {
        assert_eq!(
            host_port("http://proxy:8080").as_deref(),
            Some("proxy:8080")
        );
        assert_eq!(host_port("proxy:3128").as_deref(), Some("proxy:3128"));
        assert_eq!(
            host_port("http://user:pw@proxy:3128").as_deref(),
            Some("proxy:3128")
        );
        assert_eq!(
            host_port("http://proxy/path").as_deref(),
            Some("proxy:8080")
        );
        assert_eq!(host_port("").as_deref(), None);
    }

    #[test]
    fn loopback_never_uses_a_proxy() {
        let config = config(Some("proxy:8080"), &[]);
        for url in [
            "https://localhost/api",
            "http://127.0.0.1:5555/api",
            "https://[::1]/api",
        ] {
            assert_eq!(config.proxy_for(&url.parse().unwrap()), None, "{url}");
        }
    }

    #[test]
    fn https_requests_use_the_configured_proxy() {
        let config = config(Some("proxy:8080"), &[]);
        assert_eq!(
            config.proxy_for(&"https://shieldbattery.net/api".parse().unwrap()),
            Some("proxy:8080")
        );
    }

    #[test]
    fn bypass_entries_match_the_host_and_its_subdomains() {
        let config = config(Some("proxy:8080"), &["shieldbattery.net"]);
        for url in [
            "https://shieldbattery.net/api",
            "https://cdn.shieldbattery.net/api",
        ] {
            assert_eq!(config.proxy_for(&url.parse().unwrap()), None, "{url}");
        }
        // A host that merely ends with the same text isn't a subdomain of it.
        assert_eq!(
            config.proxy_for(&"https://notshieldbattery.net/api".parse().unwrap()),
            Some("proxy:8080")
        );
    }

    #[test]
    fn a_star_bypass_disables_the_proxy_entirely() {
        let config = config(Some("proxy:8080"), &["*"]);
        assert_eq!(
            config.proxy_for(&"https://shieldbattery.net/api".parse().unwrap()),
            None
        );
    }

    #[test]
    fn bypass_lists_split_on_commas_and_semicolons() {
        assert_eq!(
            parse_bypass("foo.com, .bar.com;baz.com"),
            vec!["foo.com", ".bar.com", "baz.com"]
        );
    }
}
