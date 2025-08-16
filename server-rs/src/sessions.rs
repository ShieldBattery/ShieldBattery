use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use axum::Extension;
use axum::body::Body;
use axum::extract::{FromRequestParts, State};
use axum::http::request::Parts;
use axum::http::{Request, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum_extra::TypedHeader;
use axum_extra::headers::Authorization;
use axum_extra::headers::authorization::Bearer;
use jsonwebtoken::DecodingKey;
use mobc_redis::redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use tracing::error;

use crate::configuration::Settings;
use crate::redis::RedisPool;
use crate::users::SbUserId;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct JwtClaims {
    session_id: String,
    user_id: SbUserId,
    /// The last time the user explicitly authenticated (as a JS unix timestamp in UTC).
    auth_time: u64,
    /// Whether the user wants to stay logged in, or have the session expire when the browser exits.
    stay_logged_in: bool,
}

#[derive(Clone, Debug)]
pub struct AuthenticatedSession {
    pub session_id: String,
    pub user_id: SbUserId,
    /// The last time the user explicitly authenticated (as a JS unix timestamp in UTC).
    pub auth_time: u64,
    /// Whether the user wants to stay logged in, or have the session expire when the browser exits.
    pub stay_logged_in: bool,

    destroyed: Arc<AtomicBool>,
}

impl AuthenticatedSession {
    fn new(claims: JwtClaims) -> Self {
        Self {
            session_id: claims.session_id,
            user_id: claims.user_id,
            auth_time: claims.auth_time,
            stay_logged_in: claims.stay_logged_in,
            destroyed: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Destroys the session, returning whether it was previously destroyed. Note that this does not
    /// actually remove the session from the store, it just marks it for deletion when the response
    /// completes.
    pub fn destroy(&self) -> bool {
        self.destroyed.swap(true, Ordering::Relaxed)
    }

    /// Returns whether this session is destroyed (e.g. the data should not be used and it will
    /// be removed from the session store).
    pub fn is_destroyed(&self) -> bool {
        self.destroyed.load(Ordering::Relaxed)
    }
}

#[derive(Clone, Debug)]
pub enum SbSession {
    Authenticated(AuthenticatedSession),
    Anonymous,
}

fn session_key(user_id: SbUserId, session_id: &str) -> String {
    let user_id: i32 = user_id.into();
    format!("sessions:{user_id}:{session_id}")
}

async fn load_session(
    redis_pool: &RedisPool,
    jwt_key: Arc<DecodingKey>,
    auth_header: Option<TypedHeader<Authorization<Bearer>>>,
) -> color_eyre::Result<SbSession, (StatusCode, &'static str)> {
    let Some(token) = auth_header.as_ref().map(|d| d.token()) else {
        return Ok(SbSession::Anonymous);
    };

    let token_data = match jsonwebtoken::decode::<JwtClaims>(
        token,
        &jwt_key,
        &jsonwebtoken::Validation::default(),
    ) {
        Ok(d) => d,
        Err(e) => {
            return match e.kind() {
                jsonwebtoken::errors::ErrorKind::ExpiredSignature => Ok(SbSession::Anonymous),
                e => {
                    tracing::warn!("Invalid JWT: {e:?}");
                    Err((StatusCode::BAD_REQUEST, "Invalid JWT"))
                }
            };
        }
    };
    let claims = token_data.claims;

    let mut redis = redis_pool.get().await.map_err(|_err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not connect to Redis",
        )
    })?;

    let exists: bool = redis
        .exists(session_key(claims.user_id, &claims.session_id))
        .await
        .map_err(|_err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not check session existence in Redis",
            )
        })?;

    if !exists {
        return Ok(SbSession::Anonymous);
    }

    // TODO(tec27): Should maybe grab the auth time from redis instead of using what's in the
    // JWT?
    Ok(SbSession::Authenticated(AuthenticatedSession::new(claims)))
}

pub async fn jwt_middleware(
    State(settings): State<Arc<Settings>>,
    State(jwt_key): State<Arc<DecodingKey>>,
    State(redis_pool): State<RedisPool>,
    auth_header: Option<TypedHeader<Authorization<Bearer>>>,
    mut request: Request<Body>,
    next: Next,
) -> Response {
    let session = match load_session(&redis_pool, jwt_key, auth_header).await {
        Ok(s) => s,
        Err(r) => {
            return r.into_response();
        }
    };

    request.extensions_mut().insert(session.clone());
    let response = next.run(request).await;

    // TODO(tec27): deal with new session creation (response extensions?)
    if let SbSession::Authenticated(session) = session {
        let key = session_key(session.user_id, &session.session_id);
        let mut redis = match redis_pool.get().await {
            Ok(r) => r,
            Err(_) => {
                return (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error")
                    .into_response();
            }
        };

        if session.is_destroyed() {
            if let Err(e) = redis.del::<_, usize>(key).await {
                error!("error deleting session from Redis: {e:?}");
            }
        } else if let Err(e) = redis
            .expire::<_, bool>(key, settings.session_ttl.as_secs() as i64)
            .await
        {
            error!("error setting new session expiration: {e:?}");
        }
    }

    response
}

impl<S> FromRequestParts<S> for SbSession
where
    S: Send + Sync,
{
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let Extension(session): Extension<SbSession> = Extension::from_request_parts(parts, state)
            .await
            .expect("Session extension not found");
        Ok(session)
    }
}
