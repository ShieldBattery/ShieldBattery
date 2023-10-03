use crate::users::PublishedUserMessage;
use serde::{Deserialize, Serialize};
use typeshare::typeshare;

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum PublishedMessage {
    User(PublishedUserMessage),
}

impl PublishedMessage {
    pub fn channel(&self) -> &'static str {
        // These should always match the camel-cased version of the type name
        match self {
            Self::User(_) => "user",
        }
    }
}

impl From<PublishedUserMessage> for PublishedMessage {
    fn from(value: PublishedUserMessage) -> Self {
        Self::User(value)
    }
}
