//! The GraphQL API of publishing map files: the publish preview and publishing itself, unpublishing,
//! staff delisting and relisting, approving files held for review, and publishers linking and
//! unlinking their files.

use async_graphql::{Context, Enum, InputObject, Object, Result};
use uuid::Uuid;

use crate::graphql::errors::graphql_error;
use crate::maps::SbMapId;
use crate::maps::catalog::{
    SbMap, is_staff, load_sb_map, require_current_user, resolve_existing_map_id,
};
use crate::maps::families::graphql::{
    MapFamily, MapFamilyFileMove, MapFamilyReport, PublishedMapFamilyReportMessage, edit_error,
    load_family, load_report, publish_report_message, resolve_existing_family_id,
};
use crate::maps::families::publish::{
    self, PublishAnswer, PublishBlock, PublishError, PublishPreview,
};
use crate::maps::search::MapSearchRepo;
use crate::maps::similarity::PublishSuggestion;
use crate::users::names::NameChecker;
use crate::users::permissions::RequiredPermission;

fn publish_error(error: PublishError) -> async_graphql::Error {
    match error {
        PublishError::Edit(error) => edit_error(error),
        PublishError::Other(e) => async_graphql::Error::new(format!("{e:?}")),
        error => {
            let code = match &error {
                PublishError::MapNotFound
                | PublishError::FamilyNotFound
                | PublishError::ReportNotFound => "NOT_FOUND",
                PublishError::Blocked(block) => block.code(),
                PublishError::NotSuggested => "NOT_SUGGESTED",
                PublishError::NotPublisher => "FORBIDDEN",
                _ => "BAD_REQUEST",
            };
            graphql_error(code, error.to_string())
        }
    }
}

/// A map suggested as the one a file is a version of.
pub struct MapPublishSuggestion {
    file_id: SbMapId,
    suggestion: PublishSuggestion,
}

#[Object]
impl MapPublishSuggestion {
    async fn id(&self) -> String {
        format!(
            "map-publish-suggestion:{}:{}",
            self.file_id, self.suggestion.file_id
        )
    }

    /// The suggested map.
    async fn family(&self, ctx: &Context<'_>) -> Result<MapFamily> {
        load_family(ctx, self.suggestion.family_id).await
    }

    /// The suggested map's listed file most similar to the file.
    async fn file(&self, ctx: &Context<'_>) -> Result<SbMap> {
        load_sb_map(ctx, self.suggestion.file_id).await
    }

    /// The share of the walkable terrain the two files have in common, from 0 to 1. Only maps
    /// with a file similar enough to be a likely version are suggested.
    async fn similarity(&self) -> f64 {
        f64::from(self.suggestion.similarity)
    }

    /// Whether both files are melee maps, or both are UMS maps.
    async fn same_kind(&self) -> bool {
        self.suggestion.same_kind
    }

    /// How alike the two files' triggers are, from 0 to 1, when both are UMS maps.
    async fn trigger_similarity(&self) -> Option<f64> {
        self.suggestion.trigger_similarity.map(f64::from)
    }

    /// Whether the files have the same number of mineral fields and geysers, and the same minerals
    /// in total.
    async fn same_resources(&self) -> bool {
        self.suggestion.same_resources
    }
}

fn suggestion_objects(
    file_id: SbMapId,
    suggestions: Vec<PublishSuggestion>,
) -> Vec<MapPublishSuggestion> {
    suggestions
        .into_iter()
        .map(|suggestion| MapPublishSuggestion {
            file_id,
            suggestion,
        })
        .collect()
}

/// What publishing a file would do.
pub struct MapPublishPreview {
    file_id: SbMapId,
    preview: PublishPreview,
}

#[Object]
impl MapPublishPreview {
    async fn id(&self) -> String {
        format!("map-publish-preview:{}", self.file_id)
    }

    /// Why the current user can't publish the file. Null when they can.
    async fn blocked_reason(&self) -> Option<PublishBlock> {
        self.preview.blocked
    }

    /// The map the file is already in along with other files, because it's the same as one of
    /// them. Publishing lists the file in this map, and asks nothing.
    async fn existing_map(&self, ctx: &Context<'_>) -> Result<Option<MapFamily>> {
        match self.preview.existing_family {
            Some(id) => load_family(ctx, id).await.map(Some),
            None => Ok(None),
        }
    }

    /// The maps the file may be a version of, the likeliest first. Empty when `existingMap` is set.
    async fn suggestions(&self) -> Vec<MapPublishSuggestion> {
        suggestion_objects(self.file_id, self.preview.suggestions.clone())
    }

    /// Whether publishing will hold the file for staff to review instead of listing it, because
    /// its name or description needs a look.
    async fn needs_review(&self) -> bool {
        self.preview.needs_review
    }
}

/// How the publisher answers "is this file a version of one of these maps?".
#[derive(Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum MapPublishAnswerKind {
    /// List the file where it is: in a map of its own, or in its `existingMap`.
    Keep,
    /// The file is a version of `familyId`: list it in that map.
    Join,
    /// The file might be a version of `familyId`: list it in a map of its own, and let staff
    /// decide.
    Unsure,
}

#[derive(InputObject, Clone, Debug)]
pub struct MapPublishAnswerInput {
    pub kind: MapPublishAnswerKind,
    /// One of the suggested maps. Required for `JOIN` and `UNSURE`, ignored for `KEEP`.
    pub family_id: Option<Uuid>,
}

/// What publishing a file did.
pub struct MapPublishResult {
    file_id: SbMapId,
    family_id: Uuid,
    held_for_review: bool,
}

#[Object]
impl MapPublishResult {
    async fn id(&self) -> String {
        format!("map-publish-result:{}", self.file_id)
    }

    async fn file(&self, ctx: &Context<'_>) -> Result<SbMap> {
        load_sb_map(ctx, self.file_id).await
    }

    /// The map the file is in now.
    async fn family(&self, ctx: &Context<'_>) -> Result<MapFamily> {
        load_family(ctx, self.family_id).await
    }

    /// Whether the file was held for staff to review instead of listed.
    async fn held_for_review(&self) -> bool {
        self.held_for_review
    }
}

#[derive(Default)]
pub struct MapPublishingQuery;

#[Object]
impl MapPublishingQuery {
    /// What publishing a file would do for the current user: whether they can, the map it would be
    /// listed in if it's the same as a file already there, the maps it may be a version of, and
    /// whether it would be held for review. Changes nothing.
    async fn map_publish_preview(
        &self,
        ctx: &Context<'_>,
        file_id: SbMapId,
    ) -> Result<MapPublishPreview> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let file_id = resolve_existing_map_id(db, file_id).await?;
        let staff = is_staff(ctx).await;
        let preview = publish::preview(db, ctx.data::<NameChecker>()?, file_id, user.id, staff)
            .await
            .map_err(publish_error)?;
        Ok(MapPublishPreview { file_id, preview })
    }

    /// The maps a file may be a version of, the likeliest first, which its publisher can link it
    /// to. Only available to the file's publisher and users who can manage maps.
    async fn map_link_suggestions(
        &self,
        ctx: &Context<'_>,
        file_id: SbMapId,
    ) -> Result<Vec<MapPublishSuggestion>> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let file_id = resolve_existing_map_id(db, file_id).await?;
        let staff = is_staff(ctx).await;
        let suggestions = publish::link_suggestions(db, file_id, user.id, staff)
            .await
            .map_err(publish_error)?;
        Ok(suggestion_objects(file_id, suggestions))
    }
}

#[derive(Default)]
pub struct MapPublishingMutation;

#[Object]
impl MapPublishingMutation {
    /// Publishes a file from the current user's library: lists it in the catalog, in the map
    /// `answer` says. A file that's already listed is left as it is. A file whose name or
    /// description needs a look is held for staff instead (`heldForReview`), who list it or not.
    async fn map_publish(
        &self,
        ctx: &Context<'_>,
        file_id: SbMapId,
        answer: MapPublishAnswerInput,
    ) -> Result<MapPublishResult> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let file_id = resolve_existing_map_id(db, file_id).await?;
        let answer = match answer.kind {
            MapPublishAnswerKind::Keep => PublishAnswer::Keep,
            kind => {
                let family_id = answer
                    .family_id
                    .ok_or_else(|| publish_error(PublishError::MissingFamily))?;
                let family_id = resolve_existing_family_id(db, family_id).await?;
                match kind {
                    MapPublishAnswerKind::Join => PublishAnswer::Join(family_id),
                    _ => PublishAnswer::Unsure(family_id),
                }
            }
        };
        let staff = is_staff(ctx).await;
        let outcome = publish::publish(
            db,
            ctx.data::<NameChecker>()?,
            file_id,
            answer,
            user.id,
            staff,
        )
        .await
        .map_err(publish_error)?;
        if let Some(report_id) = outcome.report_id {
            publish_report_message(
                ctx,
                PublishedMapFamilyReportMessage::ReportCreated { report_id },
            )
            .await;
        }
        Ok(MapPublishResult {
            file_id,
            family_id: outcome.family_id,
            held_for_review: outcome.held_for_review,
        })
    }

    /// Lists the file of an open `PUBLISH_REVIEW` report, as published by the user who published
    /// it, and resolves the report. If this lists the file, the report's `publishAnswer` is then
    /// applied on the publisher's behalf: `JOIN` moves the file into `otherFamily`, `UNSURE` files a
    /// `SAME_MAP` report about the file's map and `otherFamily`. The answer is skipped when
    /// `otherFamily` no longer exists, already holds the file, or the file no longer is the only
    /// file of its map. Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_publish_review_approve(
        &self,
        ctx: &Context<'_>,
        report_id: Uuid,
    ) -> Result<MapFamilyReport> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let same_map_report_id = publish::approve_review(db, report_id, user.id)
            .await
            .map_err(publish_error)?;
        publish_report_message(
            ctx,
            PublishedMapFamilyReportMessage::ReportStatusChanged { report_id },
        )
        .await;
        if let Some(report_id) = same_map_report_id {
            publish_report_message(
                ctx,
                PublishedMapFamilyReportMessage::ReportCreated { report_id },
            )
            .await;
        }
        load_report(db, report_id)
            .await?
            .ok_or_else(|| graphql_error("NOT_FOUND", "Report not found"))
    }

    /// Takes a file the current user published out of the listings. Anyone may publish it again.
    /// Official files can't be unpublished.
    async fn map_unpublish(&self, ctx: &Context<'_>, file_id: SbMapId) -> Result<SbMap> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let file_id = resolve_existing_map_id(db, file_id).await?;
        publish::unpublish(db, file_id, user.id)
            .await
            .map_err(publish_error)?;
        load_sb_map(ctx, file_id).await
    }

    /// Blocks a file, with an optional note (at most 500 characters) saying why, so only staff can
    /// list it from then on. Works on any file staff haven't delisted already: a listed file is
    /// taken out of the listings, a file its publisher unpublished stays unlisted, and a file that
    /// was never published stays unpublished. Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_delist(
        &self,
        ctx: &Context<'_>,
        file_id: SbMapId,
        note: Option<String>,
    ) -> Result<SbMap> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let file_id = resolve_existing_map_id(db, file_id).await?;
        publish::delist(db, file_id, note.as_deref(), user.id)
            .await
            .map_err(publish_error)?;
        load_sb_map(ctx, file_id).await
    }

    /// Undoes a delisting by staff or by the file's publisher. A file that was published is listed
    /// again, as published by whoever published it last; a file that never was is left
    /// unpublished, for anyone holding it to publish. Only available to users who can manage
    /// maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_relist(&self, ctx: &Context<'_>, file_id: SbMapId) -> Result<SbMap> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let file_id = resolve_existing_map_id(db, file_id).await?;
        publish::relist(db, file_id, user.id)
            .await
            .map_err(publish_error)?;
        load_sb_map(ctx, file_id).await
    }

    /// Moves a listed file the current user published, while it's the only file of its map, into
    /// one of the maps suggested for it (see `mapLinkSuggestions`). Its old map is merged into
    /// that map.
    async fn map_file_link(
        &self,
        ctx: &Context<'_>,
        file_id: SbMapId,
        family_id: Uuid,
    ) -> Result<MapFamilyFileMove> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let file_id = resolve_existing_map_id(db, file_id).await?;
        let family_id = resolve_existing_family_id(db, family_id).await?;
        let moved = publish::link(db, file_id, family_id, user.id)
            .await
            .map_err(publish_error)?;
        Ok(MapFamilyFileMove { file_id, moved })
    }

    /// Moves a file the current user published out of a map holding other files, into a new map
    /// of its own.
    async fn map_file_unlink(
        &self,
        ctx: &Context<'_>,
        file_id: SbMapId,
    ) -> Result<MapFamilyFileMove> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let file_id = resolve_existing_map_id(db, file_id).await?;
        let moved = publish::unlink(db, file_id, user.id)
            .await
            .map_err(publish_error)?;
        Ok(MapFamilyFileMove { file_id, moved })
    }
}
