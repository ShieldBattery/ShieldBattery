//! Keeps StarCraft: Remastered's offline entitlements available when Battle.net fails to refresh
//! them.
//!
//! SC:R reads the account's purchased content (HD graphics, skins, announcers) from
//! `%LOCALAPPDATA%\Blizzard Entertainment\ClientSdk\cookie.bin`, which Blizzard's client SDK
//! rewrites in place whenever the game is launched through Battle.net. That rewrite first writes
//! the file without its SC:R entry and then writes it again with a fresh one, so a rewrite that
//! doesn't finish leaves the file without the SC:R entry (or, if that was the only entry, empty or
//! missing). The player then loses their purchased content in ShieldBattery until a later
//! Battle.net launch succeeds.
//!
//! To ride out those failures, ShieldBattery keeps a copy of the last cookie file that held a
//! valid SC:R entry, and points the game's read of cookie.bin at that copy when the current file
//! has lost the entry or some of the account's entitlements. The copy is the file exactly as
//! Blizzard's SDK wrote it; its contents are never modified.
//!
//! The file is a protobuf `OfflineCookies` message with one `OfflineCookie` per game. Each
//! payload is an encrypted `AuthSessionResponse`, keyed from this machine's ID, so a payload that
//! authenticates also proves the file belongs to this machine:
//!
//! ```proto
//! message OfflineCookies {
//!     repeated OfflineCookie cookie = 5;
//! }
//! message OfflineCookie {
//!     required string proto_name = 1;
//!     required string proto_payload = 2; // base64 of the encrypted AuthSessionResponse
//!     required bytes signature = 3;
//!     required int64 game_id = 4;
//! }
//! message AuthSessionResponse {
//!     repeated string entitlements = 1;
//!     required int64 account_id = 4;
//!     required int64 id = 5;
//!     required int64 not_valid_after = 6;
//!     required int64 game_id = 8;
//!     optional string locale = 9;
//! }
//! ```

use std::cell::Cell;
use std::ffi::OsString;
use std::fmt;
use std::fs;
use std::io;
use std::num::NonZeroU32;
use std::os::windows::ffi::OsStringExt;
use std::path::{Path, PathBuf};
use std::ptr::{null, null_mut};
use std::sync::OnceLock;

use base64::prelude::{BASE64_STANDARD, Engine as _};
use ctr::cipher::{InnerIvInit, KeyInit, StreamCipher};
use ring::{digest, hmac, pbkdf2};

use crate::windows;

/// Blizzard's ID for StarCraft: Remastered in offline cookies.
const SCR_GAME_ID: u64 = 21297;

/// Name of the copy kept in ShieldBattery's user data directory. Deliberately doesn't end in
/// `\cookie.bin`, so opening it never looks like the game opening its own cookie file.
const BACKUP_FILENAME: &str = "scr-offline-cookie.bin";

const VERSION_CODE: u32 = 0xEFC22400;
const VERSION_CODE_LEN: usize = 4;
const PBKDF2_SALT_LEN: usize = 10;
const MAC_OUTPUT_LEN: usize = 20;
const HEADER_LEN: usize = VERSION_CODE_LEN + PBKDF2_SALT_LEN + MAC_OUTPUT_LEN;
const CIPHER_KEY_LEN: usize = 32;
const MAC_KEY_LEN: usize = 32;
const CIPHER_IV_LEN: usize = 16;
const PBKDF2_ITERATIONS: NonZeroU32 = NonZeroU32::new(8 * 1024).unwrap();

type SerpentCtr = ctr::Ctr128BE<serpent::Serpent>;

thread_local! {
    /// Set while this module reads cookie files itself, so those reads pass through the
    /// CreateFileW hook untouched.
    static INSPECTING: Cell<bool> = const { Cell::new(false) };
}

/// Whether the current thread is inside this module's own cookie file reads.
pub fn is_inspecting() -> bool {
    INSPECTING.get()
}

/// Decides which file the game's read of `real_path` (its cookie.bin) should open, returning
/// `Some(path)` when the read should go to ShieldBattery's copy instead. Also refreshes that copy
/// from `real_path` when the real file is valid.
///
/// The decision is made (and logged) once per process; later reads reuse it.
pub fn redirect_target(real_path: &Path) -> Option<PathBuf> {
    static DECISION: OnceLock<Option<PathBuf>> = OnceLock::new();
    DECISION
        .get_or_init(|| {
            let backup_path = crate::parse_args().user_data_path.join(BACKUP_FILENAME);
            INSPECTING.set(true);
            let hwids = hwid_candidates();
            let result = choose_source(real_path, &backup_path, &hwids);
            INSPECTING.set(false);
            result
        })
        .clone()
}

fn choose_source(real_path: &Path, backup_path: &Path, hwids: &[String]) -> Option<PathBuf> {
    if hwids.is_empty() {
        warn!("Offline cookie: couldn't determine this machine's ID, using cookie.bin as-is");
        return None;
    }
    let current = CookieState::inspect(real_path, hwids);
    let backup = CookieState::inspect(backup_path, hwids);
    let decision = decide(current.session(), backup.session());
    let (target, action) = match decision {
        Decision::UseBackup => (
            Some(backup_path.to_owned()),
            "using ShieldBattery's copy".into(),
        ),
        Decision::UseCurrent { refresh_backup } => {
            let action = match &current {
                CookieState::Valid { bytes, .. }
                    if refresh_backup && backup.bytes() != Some(bytes.as_slice()) =>
                {
                    match write_backup(backup_path, bytes) {
                        Ok(()) => "using cookie.bin, copy updated".into(),
                        Err(e) => format!("using cookie.bin, updating copy failed: {e}"),
                    }
                }
                _ => "using cookie.bin".into(),
            };
            (None, action)
        }
    };
    info!("Offline cookie: cookie.bin {current}; copy {backup}; {action}");
    target
}

fn write_backup(path: &Path, bytes: &[u8]) -> io::Result<()> {
    // Written whole and then moved over the old copy, so an interrupted write can never leave a
    // partial copy in place.
    let temp_path = path.with_extension("bin.tmp");
    fs::write(&temp_path, bytes)?;
    fs::rename(&temp_path, path)
}

#[derive(Debug, Copy, Clone, Eq, PartialEq)]
enum Decision {
    UseCurrent { refresh_backup: bool },
    UseBackup,
}

/// `current` and `backup` are the SC:R sessions of the real cookie file and of ShieldBattery's
/// copy, `None` when that file is missing or holds no valid SC:R entry for this machine.
fn decide(current: Option<&ScrSession>, backup: Option<&ScrSession>) -> Decision {
    match (current, backup) {
        // The same account having fewer entitlements than it used to is treated as a failed
        // refresh rather than the account losing content.
        (Some(current), Some(backup))
            if current.account_id == backup.account_id
                && is_strict_subset(&current.entitlements, &backup.entitlements) =>
        {
            Decision::UseBackup
        }
        (Some(current), _) => Decision::UseCurrent {
            refresh_backup: !current.entitlements.is_empty(),
        },
        (None, Some(_)) => Decision::UseBackup,
        (None, None) => Decision::UseCurrent {
            refresh_backup: false,
        },
    }
}

fn is_strict_subset(subset: &[String], superset: &[String]) -> bool {
    subset.iter().all(|e| superset.contains(e)) && superset.iter().any(|e| !subset.contains(e))
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct ScrSession {
    entitlements: Vec<String>,
    account_id: u64,
    /// Unix seconds.
    not_valid_after: i64,
}

enum CookieState {
    Missing,
    Unreadable(io::Error),
    Invalid(InvalidCookie),
    Valid { session: ScrSession, bytes: Vec<u8> },
}

impl CookieState {
    fn inspect(path: &Path, hwids: &[String]) -> CookieState {
        match fs::read(path) {
            Ok(bytes) => match validate(&bytes, hwids) {
                Ok(session) => CookieState::Valid { session, bytes },
                Err(e) => CookieState::Invalid(e),
            },
            Err(e) if e.kind() == io::ErrorKind::NotFound => CookieState::Missing,
            Err(e) => CookieState::Unreadable(e),
        }
    }

    fn session(&self) -> Option<&ScrSession> {
        match self {
            CookieState::Valid { session, .. } => Some(session),
            _ => None,
        }
    }

    fn bytes(&self) -> Option<&[u8]> {
        match self {
            CookieState::Valid { bytes, .. } => Some(bytes),
            _ => None,
        }
    }
}

impl fmt::Display for CookieState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CookieState::Missing => write!(f, "missing"),
            CookieState::Unreadable(e) => write!(f, "unreadable ({e})"),
            CookieState::Invalid(e) => write!(f, "invalid ({e})"),
            CookieState::Valid { session, .. } => {
                write!(
                    f,
                    "valid (entitlements: [{}], ",
                    session.entitlements.join(", ")
                )?;
                match chrono::DateTime::from_timestamp(session.not_valid_after, 0) {
                    Some(time) => write!(
                        f,
                        "not valid after {})",
                        time.format("%Y-%m-%d %H:%M:%S UTC")
                    ),
                    None => write!(f, "not valid after {})", session.not_valid_after),
                }
            }
        }
    }
}

#[derive(Debug, Copy, Clone, Eq, PartialEq)]
enum InvalidCookie {
    Malformed,
    NoScrEntry,
    UnknownVersion,
    /// The payload doesn't authenticate with this machine's ID: the file was written for another
    /// machine, or is corrupt.
    MacMismatch,
}

impl fmt::Display for InvalidCookie {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            InvalidCookie::Malformed => "malformed",
            InvalidCookie::NoScrEntry => "no StarCraft: Remastered entry",
            InvalidCookie::UnknownVersion => "unknown payload version",
            InvalidCookie::MacMismatch => "doesn't match this machine, or corrupt",
        })
    }
}

fn validate(file: &[u8], hwids: &[String]) -> Result<ScrSession, InvalidCookie> {
    let payload = find_scr_payload(file)?;
    let payload = BASE64_STANDARD
        .decode(payload)
        .map_err(|_| InvalidCookie::Malformed)?;
    let mut result = Err(InvalidCookie::MacMismatch);
    for hwid in hwids {
        match decrypt_payload(&payload, hwid) {
            Ok(plaintext) => return parse_session(&plaintext),
            Err(e) => result = Err(e),
        }
    }
    result
}

/// Returns the (still base64-encoded) payload of the file's SC:R entry.
fn find_scr_payload(file: &[u8]) -> Result<&[u8], InvalidCookie> {
    for field in ProtoFields::new(file) {
        let (5, WireValue::Bytes(cookie)) = field? else {
            continue;
        };
        let mut payload = None;
        let mut game_id = None;
        for field in ProtoFields::new(cookie) {
            match field? {
                (2, WireValue::Bytes(bytes)) => payload = Some(bytes),
                (4, WireValue::Varint(value)) => game_id = Some(value),
                _ => (),
            }
        }
        if game_id == Some(SCR_GAME_ID) {
            return payload.ok_or(InvalidCookie::Malformed);
        }
    }
    Err(InvalidCookie::NoScrEntry)
}

fn derive_keys(hwid: &str, salt: &[u8]) -> [u8; CIPHER_KEY_LEN + MAC_KEY_LEN + CIPHER_IV_LEN] {
    let mut keys = [0u8; CIPHER_KEY_LEN + MAC_KEY_LEN + CIPHER_IV_LEN];
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA512,
        PBKDF2_ITERATIONS,
        salt,
        hwid.as_bytes(),
        &mut keys,
    );
    keys
}

fn payload_mac(mac_key: &[u8], ciphertext: &[u8]) -> hmac::Tag {
    hmac::sign(&hmac::Key::new(hmac::HMAC_SHA512, mac_key), ciphertext)
}

fn decrypt_payload(payload: &[u8], hwid: &str) -> Result<Vec<u8>, InvalidCookie> {
    if payload.len() < HEADER_LEN {
        return Err(InvalidCookie::Malformed);
    }
    let (version, rest) = payload.split_at(VERSION_CODE_LEN);
    let (salt, rest) = rest.split_at(PBKDF2_SALT_LEN);
    let (mac, ciphertext) = rest.split_at(MAC_OUTPUT_LEN);
    if version != VERSION_CODE.to_be_bytes() {
        return Err(InvalidCookie::UnknownVersion);
    }

    let keys = derive_keys(hwid, salt);
    let (cipher_key, rest) = keys.split_at(CIPHER_KEY_LEN);
    let (mac_key, iv) = rest.split_at(MAC_KEY_LEN);
    if payload_mac(mac_key, ciphertext).as_ref()[..MAC_OUTPUT_LEN] != *mac {
        return Err(InvalidCookie::MacMismatch);
    }

    let mut plaintext = ciphertext.to_vec();
    serpent_ctr(cipher_key, iv).apply_keystream(&mut plaintext);
    Ok(plaintext)
}

fn serpent_ctr(key: &[u8], iv: &[u8]) -> SerpentCtr {
    // Serpent's nominal key size is 16 bytes, so the 32 byte key has to go through its
    // variable-length constructor rather than `KeyIvInit::new_from_slices`.
    let serpent = serpent::Serpent::new_from_slice(key).expect("Serpent accepts 32 byte keys");
    SerpentCtr::from_core(ctr::CtrCore::inner_iv_init(serpent, iv.into()))
}

fn parse_session(plaintext: &[u8]) -> Result<ScrSession, InvalidCookie> {
    let mut entitlements = Vec::new();
    let mut account_id = None;
    let mut not_valid_after = None;
    let mut game_id = None;
    for field in ProtoFields::new(plaintext) {
        match field? {
            (1, WireValue::Bytes(bytes)) => {
                let entitlement =
                    std::str::from_utf8(bytes).map_err(|_| InvalidCookie::Malformed)?;
                entitlements.push(entitlement.to_owned());
            }
            (4, WireValue::Varint(value)) => account_id = Some(value),
            // int64 varints hold the two's complement bits of the value.
            (6, WireValue::Varint(value)) => not_valid_after = Some(value as i64),
            (8, WireValue::Varint(value)) => game_id = Some(value),
            _ => (),
        }
    }
    if game_id != Some(SCR_GAME_ID) {
        return Err(InvalidCookie::NoScrEntry);
    }
    Ok(ScrSession {
        entitlements,
        account_id: account_id.ok_or(InvalidCookie::Malformed)?,
        not_valid_after: not_valid_after.ok_or(InvalidCookie::Malformed)?,
    })
}

enum WireValue<'a> {
    Varint(u64),
    Bytes(&'a [u8]),
    Fixed,
}

/// Iterates the top-level fields of a protobuf message. Stops after the first error.
struct ProtoFields<'a> {
    data: &'a [u8],
}

impl<'a> ProtoFields<'a> {
    fn new(data: &'a [u8]) -> ProtoFields<'a> {
        ProtoFields { data }
    }

    fn read_varint(&mut self) -> Result<u64, InvalidCookie> {
        let mut value = 0u64;
        for shift in (0..64).step_by(7) {
            let (&byte, rest) = self.data.split_first().ok_or(InvalidCookie::Malformed)?;
            self.data = rest;
            value |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Ok(value);
            }
        }
        Err(InvalidCookie::Malformed)
    }

    fn take(&mut self, len: u64) -> Result<&'a [u8], InvalidCookie> {
        let len = usize::try_from(len)
            .ok()
            .filter(|&len| len <= self.data.len())
            .ok_or(InvalidCookie::Malformed)?;
        let (taken, rest) = self.data.split_at(len);
        self.data = rest;
        Ok(taken)
    }

    fn read_field(&mut self) -> Result<(u64, WireValue<'a>), InvalidCookie> {
        let key = self.read_varint()?;
        let value = match key & 7 {
            0 => WireValue::Varint(self.read_varint()?),
            1 => {
                self.take(8)?;
                WireValue::Fixed
            }
            2 => {
                let len = self.read_varint()?;
                WireValue::Bytes(self.take(len)?)
            }
            5 => {
                self.take(4)?;
                WireValue::Fixed
            }
            // Groups (3, 4) are deprecated and unused by this schema.
            _ => return Err(InvalidCookie::Malformed),
        };
        Ok((key >> 3, value))
    }
}

impl<'a> Iterator for ProtoFields<'a> {
    type Item = Result<(u64, WireValue<'a>), InvalidCookie>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.data.is_empty() {
            return None;
        }
        let result = self.read_field();
        if result.is_err() {
            self.data = &[];
        }
        Some(result)
    }
}

/// The machine IDs the SDK may have keyed cookies with: base64(SHA-1(MachineGuid followed by the
/// decimal serial of the volume holding the game's executable)). Both the drive letter root and
/// the volume mount point of the executable's path are tried, as they differ for installs under
/// a mounted folder.
fn hwid_candidates() -> Vec<String> {
    let Some(guid) = machine_guid() else {
        return Vec::new();
    };
    let Some(exe_path) =
        (unsafe { windows::module_name(winapi::um::libloaderapi::GetModuleHandleW(null())) })
    else {
        return Vec::new();
    };
    let exe_path = windows::winapi_str(&exe_path);

    let mut roots = Vec::new();
    if let [letter, colon, backslash, ..] = exe_path[..]
        && colon == b':' as u16
        && backslash == b'\\' as u16
    {
        roots.push(vec![letter, colon, backslash, 0]);
    }
    if let Some(root) = volume_path_name(&exe_path) {
        roots.push(root);
    }

    let mut hwids = Vec::new();
    for root in roots {
        let Some(serial) = volume_serial(&root) else {
            continue;
        };
        let digest = digest::digest(
            &digest::SHA1_FOR_LEGACY_USE_ONLY,
            format!("{guid}{serial}").as_bytes(),
        );
        let hwid = BASE64_STANDARD.encode(digest.as_ref());
        if !hwids.contains(&hwid) {
            hwids.push(hwid);
        }
    }
    hwids
}

fn machine_guid() -> Option<String> {
    use winapi::um::winreg::{
        HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ, RRF_SUBKEY_WOW6464KEY, RegGetValueW,
    };

    let key = windows::winapi_str("SOFTWARE\\Microsoft\\Cryptography");
    let value = windows::winapi_str("MachineGuid");
    // The 64-bit view: 32-bit processes are otherwise redirected to WOW6432Node, which has no
    // MachineGuid.
    let flags = RRF_RT_REG_SZ | RRF_SUBKEY_WOW6464KEY;
    let mut buf = vec![0u16; 64];
    loop {
        let mut size = (buf.len() * 2) as u32;
        let result = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                key.as_ptr(),
                value.as_ptr(),
                flags,
                null_mut(),
                buf.as_mut_ptr().cast(),
                &mut size,
            )
        };
        match result as u32 {
            winapi::shared::winerror::ERROR_SUCCESS => {
                let len = (size as usize / 2).min(buf.len());
                let text = &buf[..len];
                let text = text.split(|&c| c == 0).next().unwrap_or(text);
                return OsString::from_wide(text).into_string().ok();
            }
            winapi::shared::winerror::ERROR_MORE_DATA if buf.len() < 4096 => {
                buf.resize(size as usize / 2 + 1, 0);
            }
            error => {
                warn!("Offline cookie: reading MachineGuid failed with code {error}");
                return None;
            }
        }
    }
}

/// `path` must be nul-terminated. Returns a nul-terminated path.
fn volume_path_name(path: &[u16]) -> Option<Vec<u16>> {
    let mut buf = vec![0u16; path.len().max(4)];
    let ok = unsafe {
        winapi::um::fileapi::GetVolumePathNameW(path.as_ptr(), buf.as_mut_ptr(), buf.len() as u32)
    };
    if ok == 0 {
        return None;
    }
    let len = buf.iter().position(|&c| c == 0)?;
    buf.truncate(len + 1);
    Some(buf)
}

/// `root` must be nul-terminated.
fn volume_serial(root: &[u16]) -> Option<u32> {
    let mut serial = 0u32;
    let ok = unsafe {
        winapi::um::fileapi::GetVolumeInformationW(
            root.as_ptr(),
            null_mut(),
            0,
            &mut serial,
            null_mut(),
            null_mut(),
            null_mut(),
            0,
        )
    };
    (ok != 0).then_some(serial)
}

#[cfg(test)]
mod test {
    use super::*;

    const HWID: &str = "NfsB3ZHmuDP+ayERsNEr/lV6v/4=";
    const OTHER_HWID: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAA=";

    fn varint(mut value: u64, out: &mut Vec<u8>) {
        while value >= 0x80 {
            out.push((value as u8) | 0x80);
            value >>= 7;
        }
        out.push(value as u8);
    }

    fn varint_field(field: u64, value: u64, out: &mut Vec<u8>) {
        varint(field << 3, out);
        varint(value, out);
    }

    fn bytes_field(field: u64, value: &[u8], out: &mut Vec<u8>) {
        varint((field << 3) | 2, out);
        varint(value.len() as u64, out);
        out.extend_from_slice(value);
    }

    fn encrypt_payload(plaintext: &[u8], hwid: &str) -> Vec<u8> {
        let salt = [7u8; PBKDF2_SALT_LEN];
        let keys = derive_keys(hwid, &salt);
        let (cipher_key, rest) = keys.split_at(CIPHER_KEY_LEN);
        let (mac_key, iv) = rest.split_at(MAC_KEY_LEN);
        let mut ciphertext = plaintext.to_vec();
        serpent_ctr(cipher_key, iv).apply_keystream(&mut ciphertext);
        let mut out = VERSION_CODE.to_be_bytes().to_vec();
        out.extend_from_slice(&salt);
        out.extend_from_slice(&payload_mac(mac_key, &ciphertext).as_ref()[..MAC_OUTPUT_LEN]);
        out.extend_from_slice(&ciphertext);
        out
    }

    fn cookie(game_id: u64, account_id: u64, entitlements: &[&str], hwid: &str) -> Vec<u8> {
        let mut session = Vec::new();
        for entitlement in entitlements {
            bytes_field(1, entitlement.as_bytes(), &mut session);
        }
        varint_field(4, account_id, &mut session);
        varint_field(5, 1234, &mut session);
        varint_field(6, 1791843103, &mut session);
        varint_field(8, game_id, &mut session);
        bytes_field(9, b"USA", &mut session);

        let payload = BASE64_STANDARD.encode(encrypt_payload(&session, hwid));
        let mut cookie = Vec::new();
        bytes_field(
            1,
            b"classic.protocol.v1.authentication.AuthSessionResponse",
            &mut cookie,
        );
        bytes_field(2, payload.as_bytes(), &mut cookie);
        bytes_field(3, &[0xaa; 256], &mut cookie);
        varint_field(4, game_id, &mut cookie);
        cookie
    }

    fn cookie_file(cookies: &[Vec<u8>]) -> Vec<u8> {
        let mut out = Vec::new();
        for cookie in cookies {
            bytes_field(5, cookie, &mut out);
        }
        out
    }

    const W3_GAME_ID: u64 = 22323;
    const FULL: &[&str] = &["sc-carbot", "hd", "scr-announcer-kim"];

    fn session(account_id: u64, entitlements: &[&str]) -> ScrSession {
        ScrSession {
            entitlements: entitlements.iter().map(|&e| e.into()).collect(),
            account_id,
            not_valid_after: 1791843103,
        }
    }

    fn hwids(list: &[&str]) -> Vec<String> {
        list.iter().map(|&h| h.into()).collect()
    }

    #[test]
    fn validates_scr_entry_among_others() {
        let file = cookie_file(&[
            cookie(W3_GAME_ID, 1, &["w3-standard"], HWID),
            cookie(SCR_GAME_ID, 1, FULL, HWID),
        ]);
        assert_eq!(validate(&file, &hwids(&[HWID])), Ok(session(1, FULL)));
    }

    #[test]
    fn tries_each_hwid_candidate() {
        let file = cookie_file(&[cookie(SCR_GAME_ID, 1, FULL, HWID)]);
        assert_eq!(
            validate(&file, &hwids(&[OTHER_HWID, HWID])),
            Ok(session(1, FULL))
        );
        assert_eq!(
            validate(&file, &hwids(&[OTHER_HWID])),
            Err(InvalidCookie::MacMismatch),
        );
    }

    #[test]
    fn missing_scr_entry() {
        let w3_only = cookie_file(&[cookie(W3_GAME_ID, 1, &["w3-standard"], HWID)]);
        assert_eq!(
            validate(&w3_only, &hwids(&[HWID])),
            Err(InvalidCookie::NoScrEntry)
        );
        assert_eq!(
            validate(&[], &hwids(&[HWID])),
            Err(InvalidCookie::NoScrEntry)
        );
    }

    #[test]
    fn truncated_file() {
        let file = cookie_file(&[cookie(SCR_GAME_ID, 1, FULL, HWID)]);
        for len in [1, 2, 10, file.len() / 2, file.len() - 1] {
            assert_eq!(
                validate(&file[..len], &hwids(&[HWID])),
                Err(InvalidCookie::Malformed),
                "length {len}",
            );
        }
    }

    #[test]
    fn corrupted_payload() {
        let mut file = cookie_file(&[cookie(SCR_GAME_ID, 1, FULL, HWID)]);
        // The payload's base64 ends a bit before the signature field; flip a character in it
        // to another valid base64 character.
        let payload_end = file
            .windows(3)
            .position(|w| w == [0x1a, 0x80, 0x02])
            .unwrap();
        let index = payload_end - 8;
        file[index] = if file[index] == b'A' { b'B' } else { b'A' };
        assert_eq!(
            validate(&file, &hwids(&[HWID])),
            Err(InvalidCookie::MacMismatch)
        );
    }

    #[test]
    fn decisions() {
        let full = session(1, FULL);
        let fewer = session(1, &["sc-carbot"]);
        let more = session(1, &["sc-carbot", "hd", "scr-announcer-kim", "new-skin"]);
        let swapped = session(1, &["sc-carbot", "new-skin"]);
        let empty = session(1, &[]);
        let other_account = session(2, &[]);
        let use_current = |refresh_backup| Decision::UseCurrent { refresh_backup };

        assert_eq!(decide(Some(&full), None), use_current(true));
        assert_eq!(decide(Some(&full), Some(&full)), use_current(true));
        assert_eq!(decide(Some(&more), Some(&full)), use_current(true));
        assert_eq!(decide(Some(&swapped), Some(&full)), use_current(true));
        assert_eq!(decide(Some(&fewer), Some(&full)), Decision::UseBackup);
        assert_eq!(decide(Some(&empty), Some(&full)), Decision::UseBackup);
        assert_eq!(decide(Some(&empty), None), use_current(false));
        assert_eq!(
            decide(Some(&other_account), Some(&full)),
            use_current(false)
        );
        assert_eq!(decide(None, Some(&full)), Decision::UseBackup);
        assert_eq!(decide(None, None), use_current(false));
    }

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(name: &str) -> TestDir {
            let path = std::env::temp_dir()
                .join(format!("sb-offline-cookie-{}-{name}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            TestDir(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn keeps_copy_and_redirects_after_losing_entry() {
        let dir = TestDir::new("redirect");
        let real = dir.0.join("cookie.bin");
        let backup = dir.0.join(BACKUP_FILENAME);
        let hwids = hwids(&[HWID]);
        let w3 = cookie(W3_GAME_ID, 1, &["w3-standard"], HWID);
        let good = cookie_file(&[cookie(SCR_GAME_ID, 1, FULL, HWID), w3.clone()]);

        // Missing both: nothing to do.
        assert_eq!(choose_source(&real, &backup, &hwids), None);
        assert!(!backup.exists());

        // A good cookie is used as-is and copied.
        fs::write(&real, &good).unwrap();
        assert_eq!(choose_source(&real, &backup, &hwids), None);
        assert_eq!(fs::read(&backup).unwrap(), good);

        // Losing the SC:R entry redirects to the copy, which stays untouched.
        fs::write(&real, cookie_file(&[w3])).unwrap();
        assert_eq!(choose_source(&real, &backup, &hwids), Some(backup.clone()));
        assert_eq!(fs::read(&backup).unwrap(), good);

        // As does losing the file entirely, or it being emptied.
        fs::remove_file(&real).unwrap();
        assert_eq!(choose_source(&real, &backup, &hwids), Some(backup.clone()));
        fs::write(&real, []).unwrap();
        assert_eq!(choose_source(&real, &backup, &hwids), Some(backup.clone()));

        // Or losing entitlements on the same account.
        let degraded = cookie_file(&[cookie(SCR_GAME_ID, 1, &[], HWID)]);
        fs::write(&real, &degraded).unwrap();
        assert_eq!(choose_source(&real, &backup, &hwids), Some(backup.clone()));
        assert_eq!(fs::read(&backup).unwrap(), good);
    }

    #[test]
    fn other_account_without_entitlements_keeps_copy() {
        let dir = TestDir::new("other-account");
        let real = dir.0.join("cookie.bin");
        let backup = dir.0.join(BACKUP_FILENAME);
        let hwids = hwids(&[HWID]);
        let good = cookie_file(&[cookie(SCR_GAME_ID, 1, FULL, HWID)]);
        fs::write(&backup, &good).unwrap();

        fs::write(&real, cookie_file(&[cookie(SCR_GAME_ID, 2, &[], HWID)])).unwrap();
        assert_eq!(choose_source(&real, &backup, &hwids), None);
        assert_eq!(fs::read(&backup).unwrap(), good);

        let other = cookie_file(&[cookie(SCR_GAME_ID, 2, &["hd"], HWID)]);
        fs::write(&real, &other).unwrap();
        assert_eq!(choose_source(&real, &backup, &hwids), None);
        assert_eq!(fs::read(&backup).unwrap(), other);
    }

    #[test]
    fn copy_from_another_machine_is_ignored() {
        let dir = TestDir::new("other-machine");
        let real = dir.0.join("cookie.bin");
        let backup = dir.0.join(BACKUP_FILENAME);
        fs::write(
            &backup,
            cookie_file(&[cookie(SCR_GAME_ID, 1, FULL, OTHER_HWID)]),
        )
        .unwrap();

        assert_eq!(choose_source(&real, &backup, &hwids(&[HWID])), None);
    }
}
