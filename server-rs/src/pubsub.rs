use crate::{news::PublishedNewsMessage, users::PublishedUserMessage};
use serde::{Deserialize, Serialize};
use typeshare::typeshare;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
#[typeshare]
pub enum PublishedMessage {
    News(PublishedNewsMessage),
    User(PublishedUserMessage),
}

impl PublishedMessage {
    pub fn channel(&self) -> &'static str {
        // These should always match the camel-cased version of the type name
        match self {
            Self::News(_) => "news",
            Self::User(_) => "user",
        }
    }
}

impl From<PublishedNewsMessage> for PublishedMessage {
    fn from(value: PublishedNewsMessage) -> Self {
        Self::News(value)
    }
}

impl From<PublishedUserMessage> for PublishedMessage {
    fn from(value: PublishedUserMessage) -> Self {
        Self::User(value)
    }
}
