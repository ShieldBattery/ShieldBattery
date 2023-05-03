use async_graphql::SimpleObject;
use async_trait::async_trait;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::StatusCode;
use axum::{Extension, RequestPartsExt};
use color_eyre::eyre;
use color_eyre::eyre::WrapErr;
use mobc_redis::redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::redis::{get_redis, RedisPool};

#[derive(Clone, Debug, Deserialize, Serialize, SimpleObject)]
#[serde(rename_all = "camelCase")]
pub struct SbPermissions {
    pub edit_permissions: bool,
    pub debug: bool,
    pub ban_users: bool,
    pub manage_leagues: bool,
    pub manage_maps: bool,
    pub manage_map_pools: bool,
    pub manage_matchmaking_seasons: bool,
    pub manage_matchmaking_times: bool,
    pub manage_rally_point_servers: bool,
    pub mass_delete_maps: bool,
    pub moderate_chat_channels: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSessionData {
    pub user_id: i32,
    pub user_name: String,
    pub email: String,
    pub email_verified: bool,
    pub accepted_privacy_version: u32,
    pub accepted_terms_version: u32,
    pub accepted_use_policy_version: u32,
    pub locale: Option<String>,

    pub permissions: SbPermissions,
    pub last_queued_matchmaking_type: String,
}

#[derive(Clone, Debug)]
pub struct AuthenticatedSession {
    pub id: String,
    pub data: UserSessionData,
}

#[derive(Clone, Debug)]
pub struct AnonymousSession {
    pub id: Option<String>,
}

#[derive(Clone, Debug)]
pub enum SbSession {
    Authenticated(AuthenticatedSession),
    Anonymous(AnonymousSession),
}

fn session_key(session_id: &str) -> String {
    format!("koa:sess:{session_id}")
}

fn user_sessions_set_key(user_id: i32) -> String {
    format!("user_sessions:{user_id}")
}

#[async_trait]
impl<S> FromRequestParts<S> for SbSession
where
    S: Send + Sync,
{
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let Some(session_id) = parts.headers.get("sb-session-id").and_then(|s| s.to_str().ok().map(|s| s.to_owned())) else {
            return Ok(SbSession::Anonymous(AnonymousSession { id: None }));
        };

        if session_id.len() < 16 || session_id.len() > 64 {
            return Err((StatusCode::BAD_REQUEST, "Invalid session ID"));
        }

        let Extension(redis_pool) = parts
            .extract::<Extension<RedisPool>>()
            .await
            .map_err(|_err| (StatusCode::INTERNAL_SERVER_ERROR, "Missing Redis pool"))?;
        let mut redis = get_redis(&redis_pool).await.map_err(|_err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not connect to Redis",
            )
        })?;

        let session_json: Option<String> =
            redis.get(session_key(&session_id)).await.map_err(|_err| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Could not retrieve session from Redis",
                )
            })?;
        let session = session_json.and_then(|j| serde_json::from_str::<UserSessionData>(&j).ok());

        match session {
            Some(s) => Ok(SbSession::Authenticated(AuthenticatedSession {
                id: session_id.to_owned(),
                data: s,
            })),
            None => Ok(SbSession::Anonymous(AnonymousSession {
                id: Some(session_id.to_owned()),
            })),
        }
    }
}

/// Merges JSON value `b` into JSON value `a` recursively (in place).
fn merge_json(a: &mut serde_json::Value, b: &serde_json::Value) {
    match (a, b) {
        (a @ &mut serde_json::Value::Object(_), serde_json::Value::Object(b)) => {
            let a = a.as_object_mut().unwrap();
            for (k, v) in b {
                merge_json(a.entry(k).or_insert(serde_json::Value::Null), v);
            }
        }
        (a, b) => *a = b.clone(),
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn json_merging() {
        let mut a = serde_json::json!({
            "a": 1,
            "b": {
                "c": 2,
                "d": 3,
            },
            "e": 4,
        });
        let b = serde_json::json!({
            "b": {
                "c": 5,
            },
            "e": 6,
            "f": 7
        });
        merge_json(&mut a, &b);
        assert_eq!(
            a,
            serde_json::json!({
                "a": 1,
                "b": {
                    "c": 5,
                    "d": 3,
                },
                "e": 6,
                "f": 7,
            })
        );
    }
}

/// Updates all sessions for a given user to match the session provided.
#[tracing::instrument(skip_all)]
pub async fn update_all_sessions_for_user(
    reference_session: &AuthenticatedSession,
    redis_pool: &RedisPool,
) -> Result<(), eyre::Error> {
    let mut redis = get_redis(redis_pool)
        .await
        .wrap_err("Failed to get Redis connection")?;

    let user_id = reference_session.data.user_id;
    let session_keys: Vec<String> = redis
        .smembers(user_sessions_set_key(user_id))
        .await
        .wrap_err("Failed to get session IDs")?;

    if session_keys.is_empty() {
        warn!("No sessions found to update for user {user_id}");
        return Ok(());
    };

    let data = serde_json::to_value(&reference_session.data)
        .wrap_err("Serializing reference session failed")?;

    // TODO(tec27): Update these in parallel instead? Or remove the data from sessions that requires
    // doing this in the first place?
    for key in session_keys {
        tracing::debug!("Updating session {key}");
        let old_data: Result<Option<String>, eyre::Error> = redis
            .get(key.clone())
            .await
            .wrap_err("Failed to get session");

        let Ok(old_data) = old_data else {
            warn!("Ignoring session error: {}", old_data.unwrap_err());
            continue;
        };
        let Some(old_data) = old_data else {
            if let Err(e) = redis
                .srem::<_, _, ()>(user_sessions_set_key(user_id), key.clone())
                .await
                .wrap_err("Failed to remove session from user sessions") {
                warn!("Ignoring session error: {e}");
            }
            continue;
        };

        let old_data = serde_json::from_str::<serde_json::Value>(&old_data)
            .wrap_err("Deserializing old session failed");
        let Ok(mut old_data) = old_data else {
            warn!("Ignoring session error: {}", old_data.unwrap_err());
            continue;
        };

        merge_json(&mut old_data, &data);
        let new_data = serde_json::to_string(&old_data).wrap_err("Serializing new session failed");
        let Ok(new_data) = new_data else {
            warn!("Ignoring session error: {}", new_data.unwrap_err());
            continue;
        };

        let r = redis
            .set::<_, _, ()>(key, new_data)
            .await
            .wrap_err("Failed to set session");

        if let Err(e) = r {
            warn!("Ignoring session error: {e}");
        };
    }

    Ok(())
}
