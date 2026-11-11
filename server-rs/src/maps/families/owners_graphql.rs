//! The GraphQL API of map owners: claiming a map and giving it up, staff setting and removing
//! owners and credits and granting or rejecting claims, and the messages that tell owners and
//! claimants what happened.

use async_graphql::{Context, Object, Result};
use chrono::{DateTime, Utc};
use color_eyre::eyre::WrapErr;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use typeshare::typeshare;
use uuid::Uuid;

use crate::graphql::errors::graphql_error;
use crate::maps::SbMapId;
use crate::maps::catalog::{is_staff, load_sb_map, load_user, require_current_user};
use crate::maps::families::edit::FileMove;
use crate::maps::families::graphql::{
    MapFamily, load_family, load_family_through_aliases, resolve_existing_family_id,
};
use crate::maps::families::owners::{
    self, ClaimBlock, ClaimPreview, FamilyOwner, MapOwnerClaimStatus, OwnerError,
};
use crate::maps::search::MapSearchRepo;
use crate::redis::RedisPool;
use crate::users::permissions::RequiredPermission;
use crate::users::{SbUser, SbUserId};

/// The most claims one page may hold.
const MAX_PAGE: i32 = 100;

/// Messages published to Node (via Redis pub/sub) about changes to who owns a map, for the users
/// they concern. Node turns them into notifications. `name` is the map's name (its current file's
/// name) when the change was made.
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum PublishedMapOwnerMessage {
    /// Staff granted a claim, making the claimant the map's owner. Not sent for claims granted at
    /// once, nor to staff granting their own claim.
    #[serde(rename_all = "camelCase")]
    ClaimGranted {
        claim_id: Uuid,
        family_id: Uuid,
        claimant_id: SbUserId,
        name: String,
    },
    /// Staff rejected a claim. Not sent to staff rejecting their own claim.
    #[serde(rename_all = "camelCase")]
    ClaimRejected {
        claim_id: Uuid,
        family_id: Uuid,
        claimant_id: SbUserId,
        name: String,
    },
    /// Staff made a user the map's owner directly (or verified them as its owner).
    #[serde(rename_all = "camelCase")]
    OwnerSet {
        family_id: Uuid,
        owner_id: SbUserId,
        name: String,
    },
    /// The owner lost the map through someone else's action: staff removed or replaced them, or
    /// the map was merged into another one (`familyId` is then an old id of that map). Not sent
    /// when the owner gave the map up or made the change themselves.
    #[serde(rename_all = "camelCase")]
    OwnershipRemoved {
        family_id: Uuid,
        owner_id: SbUserId,
        name: String,
    },
    /// Someone other than the owner moved a file into their map.
    #[serde(rename_all = "camelCase")]
    FileAdded {
        family_id: Uuid,
        owner_id: SbUserId,
        file_id: SbMapId,
        file_name: String,
        name: String,
        actor_id: SbUserId,
    },
    /// Someone other than the owner moved a file out of their map.
    #[serde(rename_all = "camelCase")]
    FileRemoved {
        family_id: Uuid,
        owner_id: SbUserId,
        file_id: SbMapId,
        file_name: String,
        name: String,
        actor_id: SbUserId,
    },
}

/// Publishes a map owner message. Best-effort: a failed publish only costs a notification, so it
/// doesn't fail the request.
pub(crate) async fn publish_owner_message(ctx: &Context<'_>, message: PublishedMapOwnerMessage) {
    let Some(redis) = ctx.data_opt::<RedisPool>() else {
        tracing::warn!("no RedisPool available to publish a map owner message");
        return;
    };
    if let Err(err) = redis.publish(message).await {
        tracing::error!("failed to publish map owner message: {err:?}");
    }
}

/// Tells an owner they lost their map, unless they're the one who made the change.
pub(crate) async fn notify_ownership_removed(
    ctx: &Context<'_>,
    owner: Option<FamilyOwner>,
    actor: SbUserId,
) {
    let Some(owner) = owner.filter(|o| o.owner_id != actor) else {
        return;
    };
    publish_owner_message(
        ctx,
        PublishedMapOwnerMessage::OwnershipRemoved {
            family_id: owner.family_id,
            owner_id: owner.owner_id,
            name: owner.name,
        },
    )
    .await;
}

/// Tells the owners of the maps a file moved between, other than `actor`, that it was added to or
/// removed from their map, and the owner of a map the move merged away that they lost it.
pub(crate) async fn notify_file_move(
    ctx: &Context<'_>,
    file_id: SbMapId,
    moved: &FileMove,
    actor: SbUserId,
) {
    notify_ownership_removed(ctx, moved.dropped_owner.clone(), actor).await;
    let added = moved.target_owner.as_ref().filter(|o| o.owner_id != actor);
    let removed = moved.source_owner.as_ref().filter(|o| o.owner_id != actor);
    if added.is_none() && removed.is_none() {
        return;
    }
    let file_name = match load_sb_map(ctx, file_id).await {
        Ok(file) => file.name,
        Err(err) => {
            tracing::error!("failed to load a moved file to notify its map's owner: {err:?}");
            return;
        }
    };
    if let Some(owner) = added {
        publish_owner_message(
            ctx,
            PublishedMapOwnerMessage::FileAdded {
                family_id: owner.family_id,
                owner_id: owner.owner_id,
                file_id,
                file_name: file_name.clone(),
                name: owner.name.clone(),
                actor_id: actor,
            },
        )
        .await;
    }
    if let Some(owner) = removed {
        publish_owner_message(
            ctx,
            PublishedMapOwnerMessage::FileRemoved {
                family_id: owner.family_id,
                owner_id: owner.owner_id,
                file_id,
                file_name,
                name: owner.name.clone(),
                actor_id: actor,
            },
        )
        .await;
    }
}

fn owner_error(error: OwnerError) -> async_graphql::Error {
    if let OwnerError::Other(e) = error {
        return async_graphql::Error::new(format!("{e:?}"));
    }
    let code = match &error {
        OwnerError::FamilyNotFound | OwnerError::UserNotFound | OwnerError::ClaimNotFound => {
            "NOT_FOUND"
        }
        OwnerError::Blocked(block) => block.code(),
        OwnerError::NotOwner => "FORBIDDEN",
        _ => "BAD_REQUEST",
    };
    graphql_error(code, error.to_string())
}

/// A claim as stored.
#[derive(Debug, Clone)]
pub struct MapOwnerClaim {
    id: Uuid,
    family_id: Uuid,
    claimant: SbUserId,
    note: Option<String>,
    status: String,
    resolved_by: Option<SbUserId>,
    resolved_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

/// A user's claim to be the maker of a map. Visible to staff and to the claimant.
#[Object]
impl MapOwnerClaim {
    async fn id(&self) -> Uuid {
        self.id
    }

    /// The claimed map. If it has since been merged, the map it was merged into.
    async fn family(&self, ctx: &Context<'_>) -> Result<Option<MapFamily>> {
        load_family_through_aliases(ctx, self.family_id).await
    }

    async fn claimant(&self, ctx: &Context<'_>) -> Result<Option<SbUser>> {
        load_user(ctx, Some(self.claimant)).await
    }

    /// What the claimant told staff. Null for a claim granted at once.
    async fn note(&self) -> Option<&str> {
        self.note.as_deref()
    }

    async fn status(&self) -> MapOwnerClaimStatus {
        MapOwnerClaimStatus::from_db(&self.status)
    }

    async fn created_at(&self) -> DateTime<Utc> {
        self.created_at
    }

    /// Who granted or rejected the claim: staff, or the claimant for a claim granted at once. Only
    /// available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn resolved_by(&self, ctx: &Context<'_>) -> Result<Option<SbUser>> {
        load_user(ctx, self.resolved_by).await
    }

    async fn resolved_at(&self) -> Option<DateTime<Utc>> {
        self.resolved_at
    }
}

async fn load_claim(db: &PgPool, id: Uuid) -> color_eyre::Result<Option<MapOwnerClaim>> {
    sqlx::query_as!(
        MapOwnerClaim,
        r#"
            SELECT id, family_id, claimant as "claimant: SbUserId", note, status,
                resolved_by as "resolved_by: SbUserId", resolved_at, created_at
            FROM map_owner_claims
            WHERE id = $1
        "#,
        id,
    )
    .fetch_optional(db)
    .await
    .wrap_err("Failed to load claim")
}

async fn require_claim(db: &PgPool, id: Uuid) -> Result<MapOwnerClaim> {
    load_claim(db, id)
        .await?
        .ok_or_else(|| graphql_error("NOT_FOUND", "Claim not found"))
}

/// What claiming a map would do for the current user.
pub struct MapOwnerClaimPreview {
    family_id: Uuid,
    preview: ClaimPreview,
}

#[Object]
impl MapOwnerClaimPreview {
    async fn id(&self) -> String {
        format!("map-owner-claim-preview:{}", self.family_id)
    }

    /// Why the current user can't claim the map. Null when they can.
    async fn blocked_reason(&self) -> Option<ClaimBlock> {
        self.preview.blocked
    }

    /// Whether claiming would make them the owner at once: nobody owns the map or is credited with
    /// it, and they published every one of its listed files. Otherwise a claim needs a note and
    /// waits for staff.
    async fn instant(&self) -> bool {
        self.preview.instant
    }

    /// The current user's claim on the map that is waiting for staff, if they have one.
    async fn open_claim(&self, ctx: &Context<'_>) -> Result<Option<MapOwnerClaim>> {
        match self.preview.open_claim {
            Some(id) => {
                let db = ctx.data::<MapSearchRepo>()?.db();
                Ok(load_claim(db, id).await?)
            }
            None => Ok(None),
        }
    }
}

/// What claiming a map did.
pub struct MapOwnerClaimResult {
    claim: MapOwnerClaim,
    family_id: Uuid,
    granted: bool,
}

#[Object]
impl MapOwnerClaimResult {
    async fn id(&self) -> String {
        format!("map-owner-claim-result:{}", self.claim.id)
    }

    async fn claim(&self) -> &MapOwnerClaim {
        &self.claim
    }

    async fn family(&self, ctx: &Context<'_>) -> Result<MapFamily> {
        load_family(ctx, self.family_id).await
    }

    /// Whether the current user became the map's owner at once. Otherwise the claim waits for
    /// staff.
    async fn granted(&self) -> bool {
        self.granted
    }
}

#[derive(Default)]
pub struct MapOwnersQuery;

#[Object]
impl MapOwnersQuery {
    /// What claiming a map would do for the current user: whether they can, whether it would make
    /// them the owner at once, and their claim on it that's waiting for staff. Changes nothing.
    async fn map_owner_claim_preview(
        &self,
        ctx: &Context<'_>,
        family_id: Uuid,
    ) -> Result<MapOwnerClaimPreview> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let family_id = resolve_existing_family_id(db, family_id).await?;
        let staff = is_staff(ctx).await;
        let preview = owners::claim_preview(db, family_id, user.id, staff)
            .await
            .map_err(owner_error)?;
        Ok(MapOwnerClaimPreview { family_id, preview })
    }

    /// Claims with a status, oldest first. Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_owner_claims(
        &self,
        ctx: &Context<'_>,
        #[graphql(default_with = "MapOwnerClaimStatus::Open")] status: MapOwnerClaimStatus,
        #[graphql(default = 20)] limit: i32,
        #[graphql(default = 0)] offset: i32,
    ) -> Result<Vec<MapOwnerClaim>> {
        let db = ctx.data::<MapSearchRepo>()?.db();
        Ok(sqlx::query_as!(
            MapOwnerClaim,
            r#"
                SELECT id, family_id, claimant as "claimant: SbUserId", note, status,
                    resolved_by as "resolved_by: SbUserId", resolved_at, created_at
                FROM map_owner_claims
                WHERE status = $1
                ORDER BY created_at, id
                LIMIT $2 OFFSET $3
            "#,
            status.as_str(),
            i64::from(limit.clamp(1, MAX_PAGE)),
            i64::from(offset.max(0)),
        )
        .fetch_all(db)
        .await
        .wrap_err("Failed to load claims")?)
    }

    /// How many claims have a status. Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_owner_claim_count(
        &self,
        ctx: &Context<'_>,
        #[graphql(default_with = "MapOwnerClaimStatus::Open")] status: MapOwnerClaimStatus,
    ) -> Result<i32> {
        let db = ctx.data::<MapSearchRepo>()?.db();
        let count = sqlx::query_scalar!(
            r#"SELECT count(*) as "count!" FROM map_owner_claims WHERE status = $1"#,
            status.as_str(),
        )
        .fetch_one(db)
        .await
        .wrap_err("Failed to count claims")?;
        Ok(i32::try_from(count).unwrap_or(i32::MAX))
    }
}

#[derive(Default)]
pub struct MapOwnersMutation;

#[Object]
impl MapOwnersMutation {
    /// Claims to be the maker of a map. Someone who published every listed file of a map nobody
    /// owns or is credited with becomes its owner at once (`granted`). Any other claim needs a
    /// `note` (at most 500 characters) telling staff why the map is theirs, and waits for staff;
    /// claiming again while it waits updates its note. A map that already has an owner can be
    /// claimed this way too.
    async fn map_owner_claim(
        &self,
        ctx: &Context<'_>,
        family_id: Uuid,
        note: Option<String>,
    ) -> Result<MapOwnerClaimResult> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let family_id = resolve_existing_family_id(db, family_id).await?;
        let staff = is_staff(ctx).await;
        let outcome = owners::claim(db, family_id, note.as_deref(), user.id, staff)
            .await
            .map_err(owner_error)?;
        Ok(MapOwnerClaimResult {
            claim: require_claim(db, outcome.claim_id).await?,
            family_id: outcome.family_id,
            granted: outcome.granted,
        })
    }

    /// Gives up the current user's ownership of a map.
    async fn map_owner_relinquish(&self, ctx: &Context<'_>, family_id: Uuid) -> Result<MapFamily> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let family_id = resolve_existing_family_id(db, family_id).await?;
        owners::relinquish(db, family_id, user.id)
            .await
            .map_err(owner_error)?;
        load_family(ctx, family_id).await
    }

    /// Makes a user a map's owner, as granted by staff, replacing any owner it has. Setting a map's
    /// self-claimed owner again verifies them. The user's claim on the map waiting for staff, if
    /// any, is granted along with it. Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_family_set_owner(
        &self,
        ctx: &Context<'_>,
        family_id: Uuid,
        user_id: SbUserId,
    ) -> Result<MapFamily> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let family_id = resolve_existing_family_id(db, family_id).await?;
        let change = owners::set_owner(db, family_id, user_id, user.id)
            .await
            .map_err(owner_error)?;
        if change.changed {
            if user_id != user.id {
                publish_owner_message(
                    ctx,
                    PublishedMapOwnerMessage::OwnerSet {
                        family_id,
                        owner_id: user_id,
                        name: change.name.clone(),
                    },
                )
                .await;
            }
            let replaced =
                change
                    .previous
                    .filter(|&previous| previous != user_id)
                    .map(|owner_id| FamilyOwner {
                        family_id,
                        owner_id,
                        name: change.name,
                    });
            notify_ownership_removed(ctx, replaced, user.id).await;
        }
        load_family(ctx, family_id).await
    }

    /// Removes a map's owner. Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_family_remove_owner(
        &self,
        ctx: &Context<'_>,
        family_id: Uuid,
    ) -> Result<MapFamily> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let family_id = resolve_existing_family_id(db, family_id).await?;
        let change = owners::remove_owner(db, family_id, user.id)
            .await
            .map_err(owner_error)?;
        let removed = change.previous.map(|owner_id| FamilyOwner {
            family_id,
            owner_id,
            name: change.name,
        });
        notify_ownership_removed(ctx, removed, user.id).await;
        load_family(ctx, family_id).await
    }

    /// Credits a map to a maker's name (at most 100 characters), for a maker who has no account.
    /// Null or blank text clears it. Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_family_set_credit(
        &self,
        ctx: &Context<'_>,
        family_id: Uuid,
        credit: Option<String>,
    ) -> Result<MapFamily> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let family_id = resolve_existing_family_id(db, family_id).await?;
        owners::set_credit(db, family_id, credit.as_deref(), user.id)
            .await
            .map_err(owner_error)?;
        load_family(ctx, family_id).await
    }

    /// Grants a claim waiting for staff: the claimant becomes the claimed map's owner (through any
    /// merges since), as granted by staff, replacing any owner it has. Other claims on the map stay
    /// open. Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_owner_claim_grant(
        &self,
        ctx: &Context<'_>,
        claim_id: Uuid,
    ) -> Result<MapOwnerClaim> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let granted = owners::grant_claim(db, claim_id, user.id)
            .await
            .map_err(owner_error)?;
        if granted.claimant != user.id {
            publish_owner_message(
                ctx,
                PublishedMapOwnerMessage::ClaimGranted {
                    claim_id,
                    family_id: granted.family_id,
                    claimant_id: granted.claimant,
                    name: granted.name.clone(),
                },
            )
            .await;
        }
        let replaced = granted.replaced_owner.map(|owner_id| FamilyOwner {
            family_id: granted.family_id,
            owner_id,
            name: granted.name,
        });
        notify_ownership_removed(ctx, replaced, user.id).await;
        require_claim(db, claim_id).await
    }

    /// Rejects a claim waiting for staff. Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_owner_claim_reject(
        &self,
        ctx: &Context<'_>,
        claim_id: Uuid,
    ) -> Result<MapOwnerClaim> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let rejected = owners::reject_claim(db, claim_id, user.id)
            .await
            .map_err(owner_error)?;
        if rejected.claimant != user.id {
            publish_owner_message(
                ctx,
                PublishedMapOwnerMessage::ClaimRejected {
                    claim_id,
                    family_id: rejected.family_id,
                    claimant_id: rejected.claimant,
                    name: rejected.name,
                },
            )
            .await;
        }
        require_claim(db, claim_id).await
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::pubsub::PublishedMessage;

    #[test]
    fn owner_messages_go_to_their_own_channel_tagged_and_camel_cased() {
        let family_id = Uuid::from_u128(1);
        let file_id = SbMapId(Uuid::from_u128(2));
        let message = PublishedMessage::from(PublishedMapOwnerMessage::FileAdded {
            family_id,
            owner_id: SbUserId(3),
            file_id,
            file_name: "File".into(),
            name: "Map".into(),
            actor_id: SbUserId(4),
        });
        assert_eq!(message.channel(), "mapOwner");
        assert_eq!(
            serde_json::to_value(&message).unwrap(),
            json!({
                "type": "mapOwner",
                "data": {
                    "type": "fileAdded",
                    "data": {
                        "familyId": family_id,
                        "ownerId": 3,
                        "fileId": file_id.0,
                        "fileName": "File",
                        "name": "Map",
                        "actorId": 4,
                    },
                },
            })
        );
        let granted = PublishedMapOwnerMessage::ClaimGranted {
            claim_id: Uuid::from_u128(5),
            family_id,
            claimant_id: SbUserId(3),
            name: "Map".into(),
        };
        assert_eq!(
            serde_json::to_value(&granted).unwrap()["data"]["claimantId"],
            json!(3)
        );
    }
}
