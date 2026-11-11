use crate::{
    game_commends::PublishedGameCommendMessage, game_reports::PublishedGameReportMessage,
    maps::families::graphql::PublishedMapFamilyReportMessage,
    maps::families::publish_graphql::PublishedMapPublishMessage,
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
    GameReport(PublishedGameReportMessage),
    GameCommend(PublishedGameCommendMessage),
    MapFamilyReport(PublishedMapFamilyReportMessage),
    MapPublish(PublishedMapPublishMessage),
}

impl PublishedMessage {
    pub fn channel(&self) -> &'static str {
        // These should always match the camel-cased version of the type name
        match self {
            Self::News(_) => "news",
            Self::User(_) => "user",
            Self::Matchmaking(_) => "matchmaking",
            Self::GameReport(_) => "gameReport",
            Self::GameCommend(_) => "gameCommend",
            Self::MapFamilyReport(_) => "mapFamilyReport",
            Self::MapPublish(_) => "mapPublish",
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

impl From<PublishedGameReportMessage> for PublishedMessage {
    fn from(value: PublishedGameReportMessage) -> Self {
        Self::GameReport(value)
    }
}

impl From<PublishedGameCommendMessage> for PublishedMessage {
    fn from(value: PublishedGameCommendMessage) -> Self {
        Self::GameCommend(value)
    }
}

impl From<PublishedMapFamilyReportMessage> for PublishedMessage {
    fn from(value: PublishedMapFamilyReportMessage) -> Self {
        Self::MapFamilyReport(value)
    }
}

impl From<PublishedMapPublishMessage> for PublishedMessage {
    fn from(value: PublishedMapPublishMessage) -> Self {
        Self::MapPublish(value)
    }
}
