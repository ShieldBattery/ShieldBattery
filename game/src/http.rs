//! The DLL's HTTP client for talking to the ShieldBattery server.
//!
//! Only two things go over HTTP from in here — the replay upload and the netcode re-home request —
//! so this is a small hand-rolled client over hyper rather than a full-featured one. It covers
//! exactly what those calls need: TLS, a response body limit, gzip decoding (the server compresses
//! responses), `multipart/form-data` for the replay upload, and HTTP proxies.
//!
//! Requests always carry the `Origin` the server's origin check expects, and always run under a
//! caller-supplied timeout — a request that hangs would otherwise keep a game-thread task alive
//! well past the point the result matters.

use std::io::Read;
use std::sync::LazyLock;
use std::time::Duration;

use bytes::Bytes;
use http_body_util::{BodyExt, Full, Limited};
use hyper::header::{
    ACCEPT_ENCODING, CONTENT_ENCODING, CONTENT_LENGTH, CONTENT_TYPE, HeaderValue, ORIGIN,
};
use hyper::{Method, Request, StatusCode, Uri};
use hyper_rustls::{HttpsConnector, HttpsConnectorBuilder};
use hyper_util::client::legacy::Client;
use hyper_util::rt::TokioExecutor;
use quick_error::quick_error;
use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::http_proxy::ProxyConnector;

/// Sent as `Origin` on every request; the server's origin check requires it for API calls that
/// don't come from a browser.
const GAME_ORIGIN: &str = "shieldbattery://game";

/// Ceiling on a response body we'll buffer. Every response this client reads is a small JSON
/// object, so this only exists to stop a wedged or hostile server from growing the DLL's memory.
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

quick_error! {
    #[derive(Debug)]
    pub enum Error {
        Timeout {
            display("request timed out")
        }
        Uri(err: hyper::http::Error) {
            display("couldn't build request: {}", err)
            from()
        }
        InvalidUri(err: hyper::http::uri::InvalidUri) {
            display("invalid url: {}", err)
            from()
        }
        Transport(err: hyper_util::client::legacy::Error) {
            display("request failed: {}", err)
            from()
        }
        Body(err: Box<dyn std::error::Error + Send + Sync>) {
            display("couldn't read response: {}", err)
        }
        Status(status: StatusCode) {
            display("server returned HTTP {}", status)
        }
        Json(err: serde_json::Error) {
            display("couldn't parse response: {}", err)
            from()
        }
        Serialize(err: serde_json::Error) {
            display("couldn't serialize request: {}", err)
        }
    }
}

type HyperClient = Client<HttpsConnector<ProxyConnector>, Full<Bytes>>;

/// Shared across every request so connections (and the proxy lookup behind them) are reused.
static CLIENT: LazyLock<HyperClient> = LazyLock::new(|| {
    let https = HttpsConnectorBuilder::new()
        .with_webpki_roots()
        // Dev servers are plain http on localhost, production is https.
        .https_or_http()
        .enable_http1()
        .wrap_connector(ProxyConnector::new());
    Client::builder(TokioExecutor::new()).build(https)
});

/// A `multipart/form-data` part: either a plain text field or a file with a name and content type.
pub enum Part {
    Text {
        name: &'static str,
        value: String,
    },
    File {
        name: &'static str,
        file_name: String,
        content_type: &'static str,
        data: Bytes,
    },
}

/// POSTs `body` as JSON and deserializes the response.
pub async fn post_json<Req: Serialize, Res: DeserializeOwned>(
    url: &str,
    body: &Req,
    timeout: Duration,
) -> Result<Res, Error> {
    let body = serde_json::to_vec(body).map_err(Error::Serialize)?;
    let request = base_request(url)?
        .header(CONTENT_TYPE, "application/json")
        .body(Full::new(Bytes::from(body)))?;
    let bytes = send(request, timeout).await?;
    Ok(serde_json::from_slice(&bytes)?)
}

/// POSTs `parts` as `multipart/form-data`, discarding the response body. Used for the replay
/// upload, whose response carries nothing the game needs.
pub async fn post_multipart(url: &str, parts: Vec<Part>, timeout: Duration) -> Result<(), Error> {
    let (content_type, body) = multipart::encode(parts);
    let request = base_request(url)?
        .header(CONTENT_TYPE, content_type)
        .header(CONTENT_LENGTH, body.len())
        .body(Full::new(body))?;
    send(request, timeout).await?;
    Ok(())
}

fn base_request(url: &str) -> Result<hyper::http::request::Builder, Error> {
    let uri: Uri = url.parse()?;
    Ok(Request::builder()
        .method(Method::POST)
        .uri(uri)
        .header(ORIGIN, HeaderValue::from_static(GAME_ORIGIN))
        // The server gzips responses; ask for it and decode below.
        .header(ACCEPT_ENCODING, HeaderValue::from_static("gzip")))
}

/// Sends a request under `timeout`, checking the status and decoding the body.
async fn send(request: Request<Full<Bytes>>, timeout: Duration) -> Result<Bytes, Error> {
    let response = tokio::time::timeout(timeout, CLIENT.request(request))
        .await
        .map_err(|_| Error::Timeout)??;

    let status = response.status();
    let gzipped = response
        .headers()
        .get(CONTENT_ENCODING)
        .is_some_and(|value| value.as_bytes().eq_ignore_ascii_case(b"gzip"));

    let body = Limited::new(response.into_body(), MAX_RESPONSE_BYTES)
        .collect()
        .await
        .map_err(Error::Body)?
        .to_bytes();

    // Check the status only after draining the body, so the connection can go back to the pool.
    if !status.is_success() {
        return Err(Error::Status(status));
    }

    if gzipped { decode_gzip(body) } else { Ok(body) }
}

fn decode_gzip(body: Bytes) -> Result<Bytes, Error> {
    let mut decoded = Vec::new();
    flate2::read::GzDecoder::new(body.as_ref())
        .take(MAX_RESPONSE_BYTES as u64)
        .read_to_end(&mut decoded)
        .map_err(|e| Error::Body(Box::new(e)))?;
    Ok(Bytes::from(decoded))
}

mod multipart {
    use bytes::{BufMut, Bytes, BytesMut};

    use super::Part;

    /// Encodes `parts` into a `multipart/form-data` body, returning the `Content-Type` value (which
    /// carries the boundary) alongside it.
    pub fn encode(parts: Vec<Part>) -> (String, Bytes) {
        let boundary = boundary(&parts);
        let mut body = BytesMut::new();
        for part in &parts {
            body.put_slice(b"--");
            body.put_slice(boundary.as_bytes());
            body.put_slice(b"\r\n");
            match part {
                Part::Text { name, value } => {
                    body.put_slice(
                        format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n")
                            .as_bytes(),
                    );
                    body.put_slice(value.as_bytes());
                }
                Part::File {
                    name,
                    file_name,
                    content_type,
                    data,
                } => {
                    body.put_slice(
                        format!(
                            "Content-Disposition: form-data; name=\"{name}\"; \
                             filename=\"{file_name}\"\r\nContent-Type: {content_type}\r\n\r\n"
                        )
                        .as_bytes(),
                    );
                    body.put_slice(data);
                }
            }
            body.put_slice(b"\r\n");
        }
        body.put_slice(b"--");
        body.put_slice(boundary.as_bytes());
        body.put_slice(b"--\r\n");

        (
            format!("multipart/form-data; boundary={boundary}"),
            body.freeze(),
        )
    }

    /// Builds a boundary that appears nowhere in the parts' contents.
    ///
    /// A boundary that collides with the payload would corrupt the upload, and the replay bytes are
    /// arbitrary binary, so a random value alone isn't enough of a guarantee — this checks and
    /// re-rolls. In practice the first candidate always wins.
    fn boundary(parts: &[Part]) -> String {
        loop {
            let candidate = format!("--shieldbattery-{}", random_hex());
            if !parts
                .iter()
                .any(|part| contains(part, candidate.as_bytes()))
            {
                return candidate;
            }
        }
    }

    fn contains(part: &Part, needle: &[u8]) -> bool {
        let haystack = match part {
            Part::Text { value, .. } => value.as_bytes(),
            Part::File { data, .. } => data.as_ref(),
        };
        haystack
            .windows(needle.len())
            .any(|window| window == needle)
    }

    fn random_hex() -> String {
        let mut bytes = [0u8; 16];
        getrandom::fill(&mut bytes).expect("no OS randomness available");
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn body_string(parts: Vec<Part>) -> (String, String) {
            let (content_type, body) = encode(parts);
            (
                content_type,
                String::from_utf8(body.to_vec()).expect("test bodies are utf8"),
            )
        }

        #[test]
        fn text_parts_are_delimited_by_the_boundary_from_the_content_type() {
            let (content_type, body) = body_string(vec![
                Part::Text {
                    name: "userId",
                    value: "27".into(),
                },
                Part::Text {
                    name: "resultCode",
                    value: "abcd".into(),
                },
            ]);
            let boundary = content_type
                .strip_prefix("multipart/form-data; boundary=")
                .expect("content type carries the boundary");

            assert!(body.starts_with(&format!("--{boundary}\r\n")));
            assert!(body.ends_with(&format!("--{boundary}--\r\n")));
            assert!(body.contains("Content-Disposition: form-data; name=\"userId\"\r\n\r\n27\r\n"));
            assert!(
                body.contains(
                    "Content-Disposition: form-data; name=\"resultCode\"\r\n\r\nabcd\r\n"
                )
            );
        }

        #[test]
        fn a_file_part_carries_its_filename_and_content_type() {
            let (_, body) = body_string(vec![Part::File {
                name: "replay",
                file_name: "game.rep".into(),
                content_type: "application/octet-stream",
                data: Bytes::from_static(b"replay bytes"),
            }]);

            assert!(body.contains(
                "Content-Disposition: form-data; name=\"replay\"; filename=\"game.rep\"\r\n\
                 Content-Type: application/octet-stream\r\n\r\nreplay bytes\r\n"
            ));
        }

        #[test]
        fn binary_data_survives_encoding_unchanged() {
            let data: Vec<u8> = (0..=255u8).collect();
            let (content_type, body) = encode(vec![Part::File {
                name: "replay",
                file_name: "game.rep".into(),
                content_type: "application/octet-stream",
                data: Bytes::from(data.clone()),
            }]);
            let boundary = content_type
                .strip_prefix("multipart/form-data; boundary=")
                .unwrap();

            // The payload appears verbatim, and the trailing delimiter still follows it.
            let start = body
                .windows(data.len())
                .position(|window| window == data.as_slice())
                .expect("payload is present unmodified");
            let tail = &body[start + data.len()..];
            assert_eq!(tail, format!("\r\n--{boundary}--\r\n").as_bytes());
        }

        #[test]
        fn the_boundary_never_collides_with_part_contents() {
            // Force the collision path by seeding a part with a value that starts like a boundary;
            // whatever gets chosen must not appear inside the content.
            let planted = "--shieldbattery-00112233445566778899aabbccddeeff".to_string();
            let (content_type, body) = encode(vec![Part::Text {
                name: "planted",
                value: planted.clone(),
            }]);
            let boundary = content_type
                .strip_prefix("multipart/form-data; boundary=")
                .unwrap();

            assert_ne!(boundary, planted);
            // The delimiter occurrences are exactly the ones encode() wrote (open + close).
            let occurrences = body
                .windows(boundary.len())
                .filter(|window| *window == boundary.as_bytes())
                .count();
            assert_eq!(occurrences, 2);
        }
    }
}
