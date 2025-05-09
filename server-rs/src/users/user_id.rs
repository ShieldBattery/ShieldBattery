use std::fmt::Display;

use async_graphql::scalar;
use serde::{Deserialize, Serialize};

#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Deserialize, Serialize, sqlx::Type)]
#[serde(transparent)]
#[sqlx(transparent)]
pub struct SbUserId(pub i32);

scalar!(
    SbUserId,
    "SbUserId",
    "A user ID in the ShieldBattery system."
);

impl From<i32> for SbUserId {
    fn from(value: i32) -> Self {
        Self(value)
    }
}

impl From<&i32> for SbUserId {
    fn from(value: &i32) -> Self {
        Self(*value)
    }
}

impl From<SbUserId> for i32 {
    fn from(value: SbUserId) -> Self {
        value.0
    }
}

impl From<&SbUserId> for i32 {
    fn from(value: &SbUserId) -> Self {
        value.0
    }
}

impl Display for SbUserId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
