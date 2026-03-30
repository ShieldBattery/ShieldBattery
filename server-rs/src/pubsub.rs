use crate::{
    matchmaking::PublishedMatchmakingMessage, news::PublishedNewsMessage,
    users::PublishedUserMessage,
};
use serde::{Deserialize, Serialize};
use typeshare::typeshare;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
#[typeshare]
pub enum PublishedMessage {
    News(PublishedNewsMessage),
    User(PublishedUserMessage),
    Matchmaking(PublishedMatchmakingMessage),
}

impl PublishedMessage {
    pub fn channel(&self) -> &'static str {
        // These should always match the camel-cased version of the type name
        match self {
            Self::News(_) => "news",
            Self::User(_) => "user",
            Self::Matchmaking(_) => "matchmaking",
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

impl From<PublishedMatchmakingMessage> for PublishedMessage {
    fn from(value: PublishedMatchmakingMessage) -> Self {
        Self::Matchmaking(value)
    }
}
