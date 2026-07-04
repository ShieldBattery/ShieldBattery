//! Turning the launch-handoff [`NetcodeV2Setup`] into the credentials the rally-point2 client
//! transport needs: an [`Identity`] (signed token + per-session signing key) and a **pinned** TLS
//! trust store for the relay(s).
//!
//! This is the security boundary of the game-side integration, so the trust decisions are
//! deliberately narrow and fail-closed:
//!
//! - **Trust is pinning-only.** Direct dual-stack relay IPs (D3) rule out a public CA, so the
//!   client trusts *exactly* the leaf cert(s) the coordinator handed the app in the session
//!   descriptor and nothing else — no webpki roots, no system roots, no "accept any". An empty or
//!   unparseable cert set is an error, never a silently-empty (and therefore trust-nothing, or
//!   worse, trust-misconfigured) store.
//! - **The private key never widens its surface.** It arrives redacted ([`Secret`]), is decoded
//!   straight into ring's `Ed25519KeyPair` inside [`Identity`], and is never logged, formatted, or
//!   returned. Key↔token mismatch is intentionally *not* checked here — the relay rejects a bad
//!   challenge response, which is where that authority lives (see `Identity::from_pkcs8`).
//! - **The token is decoded, not trusted-as-sent.** Session/slot/tenant live inside the signed
//!   token; we decode it rather than accept separately-sent copies that could disagree with it.
//!
//! Everything here is pure (no I/O, no runtime) except [`bind_endpoint`], which needs a Tokio
//! runtime to build the QUIC endpoint — so the trust/identity logic is unit-testable on its own.

use std::net::{AddrParseError, IpAddr, SocketAddr};

use base64::prelude::{BASE64_STANDARD, Engine as _};
use quick_error::quick_error;
use rally_point_client::proto::token::SignedToken;
use rally_point_client::transport::rustls::RootCertStore;
use rally_point_client::transport::rustls::pki_types::CertificateDer;
use rally_point_client::{ClientEndpoint, EndpointError, Identity};

use crate::app_messages::{NetcodeV2Relay, NetcodeV2Setup};

quick_error! {
    #[derive(Debug)]
    pub enum CredentialError {
        /// A base64 field (token, key, or cert) was not valid base64.
        Base64(field: &'static str) {
            display("netcode v2 credential field `{}` was not valid base64", field)
        }
        /// The decoded token bytes were not a well-formed `SignedToken`.
        Token {
            display("netcode v2 token could not be decoded")
        }
        /// The private key bytes were not a valid PKCS#8 Ed25519 key.
        Key {
            display("netcode v2 client private key was not a valid PKCS#8 Ed25519 key")
        }
        /// A relay's pinned certificate could not be added to the trust store.
        Cert {
            display("netcode v2 relay certificate could not be added to the trust store")
        }
        /// A relay endpoint had neither a usable IPv6 nor IPv4 address.
        NoRelayAddress {
            display("netcode v2 relay endpoint had no usable IPv4 or IPv6 address")
        }
        /// A relay address string did not parse as an IP address.
        RelayAddress(err: AddrParseError) {
            display("netcode v2 relay address did not parse: {}", err)
            source(err)
        }
        /// Building the QUIC client endpoint failed.
        Endpoint(err: EndpointError) {
            display("netcode v2 QUIC endpoint could not be built: {}", err)
            source(err)
        }
    }
}

/// A resolved relay the client can dial: its candidate addresses plus the TLS server name to
/// validate its certificate against.
#[derive(Clone, Debug)]
pub struct RelayTarget {
    /// Candidate addresses in dial-preference order: IPv6 first (the deployment is IPv6-primary,
    /// D3), then IPv4. Never empty. Which family actually works is a connectivity question only
    /// answerable at dial time, so the dialer should try these in order and use the first that
    /// connects — a client with a broken v6 route must still reach the relay over v4 (the v1 path
    /// races both families the same way).
    pub addrs: Vec<SocketAddr>,
    pub server_name: String,
}

/// Everything one game session needs to authorize against its relays: the client [`Identity`], the
/// home relay (and optional backup) to dial, and the pinned trust store covering them.
///
/// [`Identity`] is not `Clone` and owns the signing key, so this whole bundle is consumed (moved)
/// by the session setup when it builds the endpoint.
pub struct SessionCredentials {
    pub identity: Identity,
    pub home: RelayTarget,
    pub backup: Option<RelayTarget>,
    pub roots: RootCertStore,
}

impl SessionCredentials {
    /// Builds session credentials from the launch handoff. Pure — does not touch the network or an
    /// async runtime; call [`bind_endpoint`] afterward (inside the Tokio runtime) to get a dialable
    /// [`ClientEndpoint`].
    pub fn from_setup(setup: &NetcodeV2Setup) -> Result<Self, CredentialError> {
        let token_bytes = decode_base64(&setup.token, "token")?;
        let token = SignedToken::decode(&token_bytes).map_err(|_| CredentialError::Token)?;

        let key_bytes = decode_base64(setup.client_private_key.expose(), "clientPrivateKey")?;
        let identity = Identity::from_pkcs8(token, &key_bytes).map_err(|_| CredentialError::Key)?;

        // Pin every relay we might dial (home + backup) into one trust store. Building it from the
        // relays we were told to trust — and only those — is the whole point; see the module docs.
        let mut roots = RootCertStore::empty();
        add_relay_cert(&mut roots, &setup.home_relay)?;
        if let Some(backup) = &setup.backup_relay {
            add_relay_cert(&mut roots, backup)?;
        }

        let home = resolve_relay(&setup.home_relay)?;
        let backup = setup.backup_relay.as_ref().map(resolve_relay).transpose()?;

        Ok(Self {
            identity,
            home,
            backup,
            roots,
        })
    }
}

/// Builds a dialable QUIC client endpoint trusting `roots`. Must be called from within the Tokio
/// runtime that will drive it (the game DLL's async thread).
pub fn bind_endpoint(roots: RootCertStore) -> Result<ClientEndpoint, CredentialError> {
    ClientEndpoint::bind(roots).map_err(CredentialError::Endpoint)
}

fn decode_base64(value: &str, field: &'static str) -> Result<Vec<u8>, CredentialError> {
    BASE64_STANDARD
        .decode(value)
        .map_err(|_| CredentialError::Base64(field))
}

/// Adds a relay's pinned leaf certificate to `roots`, failing (never skipping) on a missing or
/// malformed cert — a silently-empty trust store would either reject every relay or, if some other
/// path later added a permissive root, trust the wrong one.
fn add_relay_cert(
    roots: &mut RootCertStore,
    relay: &NetcodeV2Relay,
) -> Result<(), CredentialError> {
    let cert_der = decode_base64(&relay.cert, "relayCert")?;
    roots
        .add(CertificateDer::from(cert_der))
        .map_err(|_| CredentialError::Cert)
}

/// Resolves the addresses to dial for a relay, in preference order (IPv6 first — the deployment
/// is IPv6-primary, D3 — then IPv4). Both families are kept: family availability can only be
/// judged at dial time, so nothing is discarded here. A present-but-malformed address is an error
/// (a coordinator handing out garbage should surface loudly), and a relay with no address at all
/// is rejected. The client endpoint is dual-stack and maps an IPv4 target to its v4-mapped form
/// internally, so either family is dialable.
fn resolve_relay(relay: &NetcodeV2Relay) -> Result<RelayTarget, CredentialError> {
    let mut addrs = Vec::new();
    for address in [&relay.address6, &relay.address4].into_iter().flatten() {
        let ip = address
            .parse::<IpAddr>()
            .map_err(CredentialError::RelayAddress)?;
        addrs.push(SocketAddr::new(ip, relay.port));
    }
    if addrs.is_empty() {
        return Err(CredentialError::NoRelayAddress);
    }
    Ok(RelayTarget {
        addrs,
        server_name: relay.server_name.clone(),
    })
}

#[cfg(test)]
mod tests {
    use rally_point_client::proto::control::TenantId;
    use rally_point_client::proto::ids::{SessionId, SlotId};
    use rally_point_client::proto::token::{
        ClientPublicKey, ExpiresAt, KeyId, Signature, TokenClaims,
    };

    use super::*;
    use crate::app_messages::Secret;

    fn relay(address4: Option<&str>, address6: Option<&str>, cert: &str) -> NetcodeV2Relay {
        NetcodeV2Relay {
            address4: address4.map(str::to_owned),
            address6: address6.map(str::to_owned),
            port: 14900,
            server_name: "relay.example".to_owned(),
            cert: cert.to_owned(),
        }
    }

    /// A structurally valid token (decodes fine; the signature is garbage, but decoding doesn't
    /// verify it — the relay does, by design).
    fn decodable_token_b64() -> String {
        let claims = TokenClaims::new(
            TenantId("tenant".to_owned()),
            SessionId(1),
            SlotId(0),
            ExpiresAt(u64::MAX),
            ClientPublicKey([0; 32]),
        );
        let token = SignedToken::from_parts(KeyId("kid".to_owned()), claims, Signature([0; 64]));
        BASE64_STANDARD.encode(token.encode().unwrap())
    }

    fn setup(home: NetcodeV2Relay) -> NetcodeV2Setup {
        NetcodeV2Setup {
            token: BASE64_STANDARD.encode([0u8; 4]),
            client_private_key: Secret::from_base64_for_test(&BASE64_STANDARD.encode([0u8; 4])),
            home_relay: home,
            backup_relay: None,
            roster: Vec::new(),
        }
    }

    #[test]
    fn both_address_families_are_kept_in_v6_first_order() {
        // Family availability is decided at dial time, so resolving must not discard either
        // address — just order them v6-first.
        let both = relay(Some("203.0.113.7"), Some("2001:db8::1"), "");
        let target = resolve_relay(&both).unwrap();
        assert_eq!(
            target.addrs,
            vec![
                "[2001:db8::1]:14900".parse::<SocketAddr>().unwrap(),
                "203.0.113.7:14900".parse::<SocketAddr>().unwrap(),
            ]
        );

        let v4_only = relay(Some("203.0.113.7"), None, "");
        assert_eq!(
            resolve_relay(&v4_only).unwrap().addrs,
            vec!["203.0.113.7:14900".parse::<SocketAddr>().unwrap()]
        );
    }

    #[test]
    fn a_relay_with_no_address_is_rejected() {
        let none = relay(None, None, "");
        assert!(matches!(
            resolve_relay(&none),
            Err(CredentialError::NoRelayAddress)
        ));
    }

    #[test]
    fn a_malformed_relay_address_is_rejected_not_ignored() {
        let bad = relay(Some("not-an-ip"), None, "");
        assert!(matches!(
            resolve_relay(&bad),
            Err(CredentialError::RelayAddress(_))
        ));

        // Even with a valid v4 present, a malformed v6 is a coordinator bug and must surface
        // loudly rather than be silently skipped.
        let bad_v6 = relay(Some("203.0.113.7"), Some(""), "");
        assert!(matches!(
            resolve_relay(&bad_v6),
            Err(CredentialError::RelayAddress(_))
        ));
    }

    #[test]
    fn an_empty_or_malformed_cert_fails_the_trust_store() {
        // A silently-empty trust store is the dangerous outcome; an unparseable / empty cert must
        // surface as an error instead.
        let mut roots = RootCertStore::empty();
        // Empty string decodes to zero bytes → not a valid cert → must error.
        assert!(matches!(
            add_relay_cert(&mut roots, &relay(Some("203.0.113.7"), None, "")),
            Err(CredentialError::Cert)
        ));
        // Non-base64 → base64 error.
        assert!(matches!(
            add_relay_cert(&mut roots, &relay(Some("203.0.113.7"), None, "!!!not base64!!!")),
            Err(CredentialError::Base64("relayCert"))
        ));
        assert!(roots.is_empty());
    }

    #[test]
    fn a_non_base64_token_is_rejected() {
        let mut s = setup(relay(Some("203.0.113.7"), None, ""));
        s.token = "!!!not base64!!!".to_owned();
        assert!(matches!(
            SessionCredentials::from_setup(&s),
            Err(CredentialError::Base64("token"))
        ));
    }

    #[test]
    fn a_malformed_token_is_rejected() {
        // Valid base64, but the bytes are not a well-formed SignedToken.
        let s = setup(relay(Some("203.0.113.7"), None, ""));
        assert!(matches!(
            SessionCredentials::from_setup(&s),
            Err(CredentialError::Token)
        ));
    }

    #[test]
    fn the_apps_pkcs8_v2_layout_is_accepted() {
        // The Electron app can't produce ring's PKCS#8 v2 form via Node's crypto API, so it
        // assembles the 85-byte v2 document itself (app/game/netcode-v2-keys.ts, tested against
        // the same RFC 8032 §7.1 vector). This asserts ring accepts exactly that byte layout —
        // if either side's template drifts, one of the two tests breaks.
        const RFC8032_SEED: [u8; 32] = [
            0x9d, 0x61, 0xb1, 0x9d, 0xef, 0xfd, 0x5a, 0x60, 0xba, 0x84, 0x4a, 0xf4, 0x92, 0xec,
            0x2c, 0xc4, 0x44, 0x49, 0xc5, 0x69, 0x7b, 0x32, 0x69, 0x19, 0x70, 0x3b, 0xac, 0x03,
            0x1c, 0xae, 0x7f, 0x60,
        ];
        const RFC8032_PUBLIC: [u8; 32] = [
            0xd7, 0x5a, 0x98, 0x01, 0x82, 0xb1, 0x0a, 0xb7, 0xd5, 0x4b, 0xfe, 0xd3, 0xc9, 0x64,
            0x07, 0x3a, 0x0e, 0xe1, 0x72, 0xf3, 0xda, 0xa6, 0x23, 0x25, 0xaf, 0x02, 0x1a, 0x68,
            0xf7, 0x07, 0x51, 0x1a,
        ];
        let mut doc = Vec::new();
        doc.extend_from_slice(&[
            0x30, 0x53, 0x02, 0x01, 0x01, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22,
            0x04, 0x20,
        ]);
        doc.extend_from_slice(&RFC8032_SEED);
        doc.extend_from_slice(&[0xa1, 0x23, 0x03, 0x21, 0x00]);
        doc.extend_from_slice(&RFC8032_PUBLIC);

        let mut s = setup(relay(Some("203.0.113.7"), None, ""));
        s.token = decodable_token_b64();
        s.client_private_key = Secret::from_base64_for_test(&BASE64_STANDARD.encode(&doc));
        // The cert is empty (invalid), so success on the key path shows up as a *cert* error —
        // reaching it means the token and key both decoded.
        assert!(matches!(
            SessionCredentials::from_setup(&s),
            Err(CredentialError::Cert)
        ));
    }

    #[test]
    fn a_garbage_private_key_is_rejected() {
        // A valid-base64 blob that is not a PKCS#8 Ed25519 key must be rejected as a *key* error.
        // The token is genuinely decodable so the key path is actually exercised (a bad token
        // would short-circuit first and leave the key check untested).
        let mut s = setup(relay(Some("203.0.113.7"), None, ""));
        s.token = decodable_token_b64();
        s.client_private_key = Secret::from_base64_for_test(&BASE64_STANDARD.encode([1u8; 8]));
        assert!(matches!(
            SessionCredentials::from_setup(&s),
            Err(CredentialError::Key)
        ));
    }
}
