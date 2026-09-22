//! The pending-link state shared by every OAuth account-linking flow (Twitch, YouTube).
//!
//! ShieldBattery authenticates every request with a bearer JWT rather than a cookie, so the client
//! opens the provider's authorize URL itself and hands the resulting `code`/`state` back over a
//! normal authenticated request. That makes the `state` value the only thing tying the redirect the
//! client received to the flow the server started, so it is issued here, bound to a user, and
//! consumed exactly once.
//!
//! Each platform passes its own `key_prefix`, so each gets a private Redis keyspace
//! (`<prefix>:link_state:<state>`) while sharing this logic.

use color_eyre::eyre::{self, Context as _};
use deadpool_redis::redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::redis::RedisPool;
use crate::users::SbUserId;

/// How long a pending link request (the server-issued `state`) stays valid. Long enough for a user
/// to complete the provider's consent screen, short enough to bound abuse of a leaked state value.
const LINK_STATE_TTL_SECONDS: u64 = 600;

fn link_state_key(key_prefix: &str, state: &str) -> String {
    format!("{key_prefix}:link_state:{state}")
}

/// What we stash in Redis for a pending link `state`: the user who started the flow, plus the
/// redirect URI baked into their authorize URL. The redirect URI differs between the web and desktop
/// flows and must be replayed verbatim in the token exchange, so we remember which one was used.
#[derive(Debug, Serialize, Deserialize)]
pub struct PendingLink {
    user_id: SbUserId,
    pub redirect_uri: String,
}

/// Starts a link flow by issuing a single-use `state` bound to `user_id` and storing it under
/// `key_prefix`, returning the state to put in the authorize URL.
///
/// The state is server-issued rather than client-supplied, and completing the link requires both it
/// (proving the flow started here) and the same user's auth token, which together prevent an
/// attacker from linking their provider account to a victim.
pub async fn store_pending_link(
    redis: &RedisPool,
    key_prefix: &str,
    user_id: SbUserId,
    redirect_uri: &str,
) -> eyre::Result<String> {
    let state = Uuid::new_v4().to_string();
    let pending = serde_json::to_string(&PendingLink {
        user_id,
        redirect_uri: redirect_uri.to_owned(),
    })
    .wrap_err("Failed to serialize pending link")?;

    let mut conn = redis.get().await.wrap_err("Could not connect to Redis")?;
    conn.set_ex::<_, _, ()>(
        link_state_key(key_prefix, &state),
        pending,
        LINK_STATE_TTL_SECONDS,
    )
    .await
    .wrap_err("Failed to store link state")?;

    Ok(state)
}

/// Validates and consumes a pending link `state`, returning it only if it exists and belongs to
/// `user_id`. Anything else (unknown, expired, another user's) reads as `None`, which callers
/// surface as their own invalid-state error.
pub async fn consume_pending_link(
    redis: &RedisPool,
    key_prefix: &str,
    state: &str,
    user_id: SbUserId,
) -> eyre::Result<Option<PendingLink>> {
    let mut conn = redis.get().await.wrap_err("Could not connect to Redis")?;
    let key = link_state_key(key_prefix, state);
    let stored: Option<String> = conn.get(&key).await.wrap_err("Failed to read link state")?;

    // Only delete the state once we've confirmed it belongs to the caller -- otherwise anyone who
    // learns another flow's `state` value (e.g. from a shared link/log) could invalidate that
    // pending link just by calling this with their own session. The GET-then-DEL here isn't atomic,
    // but that's fine: if two of the owner's own requests race, the loser just fails the single-use
    // code exchange at the provider instead of the state check.
    let pending = stored
        .and_then(|s| serde_json::from_str::<PendingLink>(&s).ok())
        .filter(|p| p.user_id == user_id);
    let Some(pending) = pending else {
        return Ok(None);
    };
    let _: () = conn
        .del(&key)
        .await
        .wrap_err("Failed to clear link state")?;

    Ok(Some(pending))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn link_state_keys_are_namespaced_per_platform() {
        // Servers on both sides of a deploy read and write these keys, so the layout is a
        // compatibility contract: a link started before a deploy must still complete after it.
        assert_eq!(link_state_key("twitch", "abc"), "twitch:link_state:abc");
        assert_eq!(link_state_key("youtube", "abc"), "youtube:link_state:abc");
    }

    #[test]
    fn a_pending_link_stores_its_user_id_as_a_bare_number() {
        let json = serde_json::to_value(PendingLink {
            user_id: SbUserId(7),
            redirect_uri: "https://example.com/callback".to_owned(),
        })
        .unwrap();

        assert_eq!(
            json,
            serde_json::json!({
                "user_id": 7,
                "redirect_uri": "https://example.com/callback",
            })
        );
    }
}
