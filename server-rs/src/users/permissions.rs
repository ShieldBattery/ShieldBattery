use crate::errors::graphql_error;
use crate::users::CurrentUser;
use async_graphql::dataloader::Loader;
use async_graphql::futures_util::TryStreamExt;
use async_graphql::{Context, Guard, InputObject, SimpleObject};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::HashMap;
use typeshare::typeshare;

#[typeshare]
#[derive(Clone, Debug, Deserialize, Serialize, SimpleObject, InputObject, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
#[graphql(input_name = "SbPermissionsInput")]
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
    pub manage_news: bool,
}

// TODO(tec27): Generate this with a macro or something?
#[derive(Eq, PartialEq, Copy, Clone)]
pub enum RequiredPermission {
    EditPermissions,
    Debug,
    BanUsers,
    ManageLeagues,
    ManageMaps,
    ManageMapPools,
    ManageMatchmakingSeasons,
    ManageMatchmakingTimes,
    ManageRallyPointServers,
    MassDeleteMaps,
    ModerateChatChannels,
}

impl RequiredPermission {
    pub fn check(&self, permissions: &SbPermissions) -> bool {
        match self {
            Self::EditPermissions => permissions.edit_permissions,
            Self::Debug => permissions.debug,
            Self::BanUsers => permissions.ban_users,
            Self::ManageLeagues => permissions.manage_leagues,
            Self::ManageMaps => permissions.manage_maps,
            Self::ManageMapPools => permissions.manage_map_pools,
            Self::ManageMatchmakingSeasons => permissions.manage_matchmaking_seasons,
            Self::ManageMatchmakingTimes => permissions.manage_matchmaking_times,
            Self::ManageRallyPointServers => permissions.manage_rally_point_servers,
            Self::MassDeleteMaps => permissions.mass_delete_maps,
            Self::ModerateChatChannels => permissions.moderate_chat_channels,
        }
    }
}

#[async_trait]
impl Guard for RequiredPermission {
    async fn check(&self, ctx: &Context<'_>) -> async_graphql::Result<()> {
        if let Some(ref user) = ctx.data_unchecked::<Option<CurrentUser>>() {
            if self.check(&user.permissions) {
                return Ok(());
            }
        }

        Err(graphql_error("FORBIDDEN", "Forbidden"))
    }
}

pub struct PermissionsLoader {
    db: PgPool,
}

impl PermissionsLoader {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

#[async_trait]
impl Loader<i32> for PermissionsLoader {
    type Value = SbPermissions;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[i32]) -> Result<HashMap<i32, Self::Value>, Self::Error> {
        Ok(sqlx::query!(
            r#"
                    SELECT user_id, edit_permissions, debug, ban_users, manage_leagues, manage_maps,
                        manage_map_pools, manage_matchmaking_seasons, manage_matchmaking_times,
                        manage_rally_point_servers, mass_delete_maps, moderate_chat_channels,
                        manage_news
                    FROM permissions
                    WHERE user_id = ANY($1)
            "#,
            keys
        )
        .fetch(&self.db)
        .map_ok(|r| {
            (
                r.user_id,
                SbPermissions {
                    edit_permissions: r.edit_permissions,
                    debug: r.debug,
                    ban_users: r.ban_users,
                    manage_leagues: r.manage_leagues,
                    manage_maps: r.manage_maps,
                    manage_map_pools: r.manage_map_pools,
                    manage_matchmaking_seasons: r.manage_matchmaking_seasons,
                    manage_matchmaking_times: r.manage_matchmaking_times,
                    manage_rally_point_servers: r.manage_rally_point_servers,
                    mass_delete_maps: r.mass_delete_maps,
                    moderate_chat_channels: r.moderate_chat_channels,
                    manage_news: r.manage_news,
                },
            )
        })
        .try_collect()
        .await?)
    }
}
