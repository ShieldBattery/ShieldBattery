use std::fs::File;
use std::io::Write;
use std::path::Path;

use async_graphql::{EmptySubscription, MergedObject, Schema, SchemaBuilder};
use tokio::io;

use crate::game_reports::{GameReportsMutation, GameReportsQuery};
use crate::games::GamesQuery;
use crate::leagues::LeaguesQuery;
use crate::live_streams::{LiveStreamsMutation, LiveStreamsQuery};
use crate::matchmaking::admin::{MatchmakingConfigMutation, MatchmakingConfigQuery};
use crate::matchmaking::history::MatchmakingHistoryQuery;
use crate::news::{NewsMutation, NewsQuery};
use crate::twitch::{TwitchMutation, TwitchQuery};
use crate::users::{UsersMutation, UsersQuery};
use crate::youtube::{YoutubeMutation, YoutubeQuery};

pub type SbSchema = Schema<Query, Mutation, EmptySubscription>;
pub type SbSchemaBuilder = SchemaBuilder<Query, Mutation, EmptySubscription>;

#[derive(MergedObject, Default)]
pub struct Query(
    GameReportsQuery,
    GamesQuery,
    LeaguesQuery,
    LiveStreamsQuery,
    NewsQuery,
    TwitchQuery,
    UsersQuery,
    YoutubeQuery,
    MatchmakingConfigQuery,
    MatchmakingHistoryQuery,
);

#[derive(MergedObject, Default)]
pub struct Mutation(
    GameReportsMutation,
    LiveStreamsMutation,
    NewsMutation,
    TwitchMutation,
    UsersMutation,
    YoutubeMutation,
    MatchmakingConfigMutation,
);

pub fn build_schema() -> SbSchemaBuilder {
    Schema::build(Query::default(), Mutation::default(), EmptySubscription)
}

/// Wrties the GraphQL schema to an SDL file at the given path.
pub fn write_schema<P>(path: P) -> io::Result<()>
where
    P: AsRef<Path>,
{
    let schema = build_schema().finish();
    let mut file = File::create(path)?;
    file.write_all(schema.sdl().as_bytes())
}
