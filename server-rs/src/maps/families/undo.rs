//! Undoing a batch of history: every member, suggestion and family label the batch changed goes
//! back to how it was before the batch, provided nothing changed it since. The undo is recorded as
//! a batch of its own, so it can be undone too.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use color_eyre::eyre::WrapErr;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::maps::SbMapId;
use crate::maps::families::edit::{FamilyEditError, check_reviewer_listed};
use crate::maps::families::graphql::MapLinkSuggestionStatus;
use crate::maps::families::history::{
    self, BatchEntry, Change, HistoryDetails, HistoryEntry, MapFamilyHistoryKind,
    MapFamilyMemberState, MapFamilySuggestionChange, Snapshot,
};
use crate::maps::families::{MapFamilyRelation, MapLinkSource, lock_families, recompute_family};
use crate::users::SbUserId;

/// What a batch changed overall: for each member, suggestion and family label, its state before
/// the batch's first change to it and after the batch's last.
#[derive(Debug, Default)]
struct BatchChanges {
    members: BTreeMap<Uuid, Change<Option<MapFamilyMemberState>>>,
    suggestions: BTreeMap<(Uuid, Uuid), Change<MapLinkSuggestionStatus>>,
    labels: BTreeMap<Uuid, Change<Option<String>>>,
}

impl BatchChanges {
    fn of(entries: &[BatchEntry]) -> Self {
        let mut changes = Self::default();
        for entry in entries {
            for member in &entry.details.members {
                changes
                    .members
                    .entry(member.map_id.0)
                    .and_modify(|c| c.after = member.after.clone())
                    .or_insert_with(|| Change {
                        before: member.before.clone(),
                        after: member.after.clone(),
                    });
            }
            for suggestion in &entry.details.suggestions {
                changes
                    .suggestions
                    .entry((suggestion.map_a.0, suggestion.map_b.0))
                    .and_modify(|c| c.after = suggestion.after)
                    .or_insert(Change {
                        before: suggestion.before,
                        after: suggestion.after,
                    });
            }
            if let (Some(label), Some(family_id)) = (&entry.details.label, entry.family_id) {
                changes
                    .labels
                    .entry(family_id)
                    .and_modify(|c| c.after = label.after.clone())
                    .or_insert_with(|| label.clone());
            }
        }
        changes
    }

    /// Every family a member was in before or after the batch.
    fn family_ids(&self) -> Vec<Uuid> {
        self.members
            .values()
            .flat_map(|c| [&c.before, &c.after])
            .flatten()
            .map(|s| s.family_id)
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    }

    /// The members the batch changed, and the parents they had before it.
    fn map_ids(&self) -> Vec<SbMapId> {
        self.members
            .iter()
            .flat_map(|(&id, c)| {
                let parent = c.before.as_ref().and_then(|s| s.parent_id);
                [Some(id), parent.map(|p| p.0)]
            })
            .flatten()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .map(SbMapId)
            .collect()
    }

    /// The members whose place undoing changes.
    fn restored_members(&self) -> impl Iterator<Item = (Uuid, &Option<MapFamilyMemberState>)> + '_ {
        self.members
            .iter()
            .filter(|(_, c)| c.before != c.after)
            .map(|(&id, c)| (id, &c.before))
    }

    /// Whether anything the batch changed was changed again since, a member would go back under a
    /// parent that's no longer where it was, or a file placed since under a member the undo takes
    /// out of its family would lose its parent. `members` holds the current place of every member
    /// of the batch's families, of every member the batch changed and of their former parents,
    /// `suggestions` the current status of every
    /// suggestion it changed, and `labels` the current label of every family whose label it changed
    /// (missing when the family is gone).
    fn conflicts(
        &self,
        members: &Snapshot,
        suggestions: &HashMap<(Uuid, Uuid), MapLinkSuggestionStatus>,
        labels: &HashMap<Uuid, Option<String>>,
    ) -> bool {
        let members_moved = self
            .members
            .iter()
            .any(|(id, c)| members.get(id) != c.after.as_ref());
        let suggestions_moved = self
            .suggestions
            .iter()
            .any(|(key, c)| suggestions.get(key) != Some(&c.after));
        let labels_moved = self
            .labels
            .iter()
            .any(|(id, c)| labels.get(id) != Some(&c.after));
        let parent_gone = self.restored_members().any(|(_, before)| {
            let Some(before) = before else {
                return false;
            };
            let Some(parent) = before.parent_id else {
                return false;
            };
            let parent_family = match self.members.get(&parent.0) {
                Some(c) => c.before.as_ref().map(|s| s.family_id),
                None => members.get(&parent.0).map(|s| s.family_id),
            };
            parent_family != Some(before.family_id)
        });
        let leaving: BTreeSet<Uuid> = self
            .restored_members()
            .filter(|(id, before)| {
                members
                    .get(id)
                    .is_some_and(|now| before.as_ref().is_none_or(|b| b.family_id != now.family_id))
            })
            .map(|(id, _)| id)
            .collect();
        let orphaned = members.iter().any(|(id, now)| {
            !self.members.contains_key(id) && now.parent_id.is_some_and(|p| leaving.contains(&p.0))
        });
        members_moved || suggestions_moved || labels_moved || parent_gone || orphaned
    }
}

/// A write that broke a constraint means the families changed in a way the undo can't put back.
fn constraint_conflict(error: sqlx::Error) -> FamilyEditError {
    let violated = error
        .as_database_error()
        .is_some_and(|e| e.is_unique_violation() || e.is_foreign_key_violation());
    if violated {
        FamilyEditError::Conflict
    } else {
        FamilyEditError::Other(error.into())
    }
}

/// Reverts the batch holding `entry_id`: each member, suggestion and family label it changed goes
/// back to its state before the batch, as long as each is still as the batch left it. Only staff
/// may undo someone else's batch or a family label; reviewers may only undo changes to listed maps.
/// Returns the undo's own history entry.
pub async fn undo(
    tx: &mut Transaction<'_, Postgres>,
    entry_id: Uuid,
    source: MapLinkSource,
    actor: SbUserId,
) -> Result<Option<Uuid>, FamilyEditError> {
    lock_families(tx).await?;
    let entries = history::load_batch(tx, entry_id).await?;
    let Some(first) = entries.first() else {
        return Err(FamilyEditError::HistoryEntryNotFound);
    };
    if entries
        .iter()
        .any(|e| e.kind == MapFamilyHistoryKind::ReportStatus)
    {
        return Err(FamilyEditError::UndoReport);
    }
    let staff = source == MapLinkSource::Moderator;
    if !staff && entries.iter().any(|e| e.actor != actor) {
        return Err(FamilyEditError::NotYourChange);
    }
    let changes = BatchChanges::of(&entries);
    if !staff && !changes.labels.is_empty() {
        return Err(FamilyEditError::StaffOnly);
    }
    let touched_maps: Vec<SbMapId> = changes
        .members
        .keys()
        .copied()
        .chain(changes.suggestions.keys().flat_map(|&(a, b)| [a, b]))
        .chain(
            entries
                .iter()
                .flat_map(|e| [e.map_id, e.other_map_id])
                .flatten()
                .map(|id| id.0),
        )
        .collect::<BTreeSet<_>>()
        .into_iter()
        .map(SbMapId)
        .collect();
    check_reviewer_listed(tx, source, &touched_maps).await?;
    let first_map_id = first.map_id;

    let family_ids = changes.family_ids();
    let map_ids = changes.map_ids();
    let before = history::snapshot(tx, &family_ids, &map_ids).await?;
    let suggestions = load_suggestions(tx, &changes).await?;
    let labels = load_labels(tx, &changes).await?;
    if changes.conflicts(&before, &suggestions, &labels) {
        return Err(FamilyEditError::Conflict);
    }

    restore_members(tx, &changes, &family_ids, actor).await?;
    let suggestion_changes = restore_suggestions(tx, &changes, actor).await?;
    let label_changes = restore_labels(tx, &changes).await?;

    let after = history::snapshot(tx, &family_ids, &map_ids).await?;
    let mut label_changes = label_changes.into_iter();
    let first_label = label_changes.next();
    history::record(
        tx,
        HistoryEntry {
            kind: MapFamilyHistoryKind::Undo,
            actor,
            source,
            map_id: first_map_id,
            other_map_id: None,
            family_id: first_label.as_ref().map(|(id, _)| *id),
            details: HistoryDetails {
                members: history::diff(&before, &after),
                suggestions: suggestion_changes,
                label: first_label.map(|(_, change)| change),
                undone_entry_id: Some(entry_id),
                ..Default::default()
            },
        },
    )
    .await?;
    // An entry holds one label change, so each further family's label is recorded on its own. The
    // entries share this transaction, so they're still one batch.
    for (family_id, change) in label_changes {
        history::record(
            tx,
            HistoryEntry {
                kind: MapFamilyHistoryKind::Undo,
                actor,
                source,
                map_id: None,
                other_map_id: None,
                family_id: Some(family_id),
                details: HistoryDetails {
                    label: Some(change),
                    undone_entry_id: Some(entry_id),
                    ..Default::default()
                },
            },
        )
        .await?;
    }
    Ok(history::first_entry_of_transaction(tx).await?)
}

async fn load_suggestions(
    tx: &mut Transaction<'_, Postgres>,
    changes: &BatchChanges,
) -> Result<HashMap<(Uuid, Uuid), MapLinkSuggestionStatus>, FamilyEditError> {
    let (a, b): (Vec<Uuid>, Vec<Uuid>) = changes.suggestions.keys().copied().unzip();
    if a.is_empty() {
        return Ok(HashMap::new());
    }
    let rows = sqlx::query!(
        r#"
            SELECT s.map_a, s.map_b, s.status
            FROM map_link_suggestions s
            INNER JOIN unnest($1::uuid[], $2::uuid[]) AS v(map_a, map_b)
                ON s.map_a = v.map_a AND s.map_b = v.map_b
            FOR UPDATE OF s
        "#,
        &a,
        &b,
    )
    .fetch_all(&mut **tx)
    .await
    .wrap_err("Failed to load suggestion statuses")?;
    Ok(rows
        .into_iter()
        .map(|r| {
            (
                (r.map_a, r.map_b),
                MapLinkSuggestionStatus::from_db(&r.status),
            )
        })
        .collect())
}

async fn load_labels(
    tx: &mut Transaction<'_, Postgres>,
    changes: &BatchChanges,
) -> Result<HashMap<Uuid, Option<String>>, FamilyEditError> {
    let ids: Vec<Uuid> = changes.labels.keys().copied().collect();
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows = sqlx::query!(
        "SELECT id, label FROM map_families WHERE id = ANY($1) FOR UPDATE",
        &ids,
    )
    .fetch_all(&mut **tx)
    .await
    .wrap_err("Failed to load family labels")?;
    Ok(rows.into_iter().map(|r| (r.id, r.label)).collect())
}

/// Puts every member the batch changed back in its place from before the batch, then rederives
/// the lines of every family involved.
async fn restore_members(
    tx: &mut Transaction<'_, Postgres>,
    changes: &BatchChanges,
    family_ids: &[Uuid],
    actor: SbUserId,
) -> Result<(), FamilyEditError> {
    let mut removed = Vec::new();
    let mut restored: Vec<(Uuid, &MapFamilyMemberState)> = Vec::new();
    for (id, before) in changes.restored_members() {
        match before {
            Some(state) => restored.push((id, state)),
            None => removed.push(id),
        }
    }
    if restored.is_empty() && removed.is_empty() {
        return Ok(());
    }

    // A family the batch emptied is gone; it comes back under its old id, with the last label
    // anyone gave it.
    let families: Vec<Uuid> = restored
        .iter()
        .map(|(_, s)| s.family_id)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    sqlx::query!(
        r#"
            INSERT INTO map_families (id, label)
            SELECT f.id, (
                SELECT h.details -> 'label' ->> 'after'
                FROM map_family_history h
                WHERE h.family_id = f.id AND h.details ? 'label'
                ORDER BY h.created_at DESC, h.id DESC
                LIMIT 1
            )
            FROM unnest($1::uuid[]) AS f(id)
            ON CONFLICT (id) DO NOTHING
        "#,
        &families,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to recreate families")?;

    // Parents are set once every restored member exists, since a parent must be a member. Pins
    // wait until the lines are rederived, since a line holds at most one.
    let ids: Vec<Uuid> = restored.iter().map(|(id, _)| *id).collect();
    let family_of: Vec<Uuid> = restored.iter().map(|(_, s)| s.family_id).collect();
    let relations: Vec<MapFamilyRelation> = restored.iter().map(|(_, s)| s.relation).collect();
    let labels: Vec<Option<String>> = restored
        .iter()
        .map(|(_, s)| s.version_label.clone())
        .collect();
    let sources: Vec<MapLinkSource> = restored.iter().map(|(_, s)| s.source).collect();
    sqlx::query!(
        r#"
            INSERT INTO map_family_members (map_id, family_id, parent_map_id, relation,
                version_label, pinned_current, source, linked_by, linked_at, line_root_id,
                line_current_id)
            SELECT v.map_id, v.family_id, NULL, v.relation, v.version_label, false, v.source, $6,
                now(), v.map_id, v.map_id
            FROM unnest($1::uuid[], $2::uuid[], $3::map_family_relation[], $4::text[],
                $5::map_link_source[]) AS v(map_id, family_id, relation, version_label, source)
            ON CONFLICT (map_id) DO UPDATE
            SET family_id = EXCLUDED.family_id, parent_map_id = NULL,
                relation = EXCLUDED.relation, version_label = EXCLUDED.version_label,
                pinned_current = false, source = EXCLUDED.source, linked_by = EXCLUDED.linked_by,
                linked_at = EXCLUDED.linked_at, line_root_id = EXCLUDED.map_id,
                line_current_id = EXCLUDED.map_id
        "#,
        &ids,
        &family_of,
        &relations as _,
        &labels as _,
        &sources as _,
        actor as _,
    )
    .execute(&mut **tx)
    .await
    .map_err(constraint_conflict)?;

    if !removed.is_empty() {
        sqlx::query!(
            "DELETE FROM map_family_members WHERE map_id = ANY($1)",
            &removed,
        )
        .execute(&mut **tx)
        .await
        .wrap_err("Failed to remove family members")?;
    }

    let (children, parents): (Vec<Uuid>, Vec<Uuid>) = restored
        .iter()
        .filter_map(|(id, s)| Some((*id, s.parent_id?.0)))
        .unzip();
    sqlx::query!(
        r#"
            UPDATE map_family_members AS f
            SET parent_map_id = v.parent
            FROM unnest($1::uuid[], $2::uuid[]) AS v(map_id, parent)
            WHERE f.map_id = v.map_id
        "#,
        &children,
        &parents,
    )
    .execute(&mut **tx)
    .await
    .map_err(constraint_conflict)?;

    for &family_id in family_ids {
        recompute_family(tx, family_id).await?;
    }
    let pinned: Vec<Uuid> = restored
        .iter()
        .filter(|(_, s)| s.pinned_current)
        .map(|(id, _)| *id)
        .collect();
    if !pinned.is_empty() {
        sqlx::query!(
            "UPDATE map_family_members SET pinned_current = true WHERE map_id = ANY($1)",
            &pinned,
        )
        .execute(&mut **tx)
        .await
        .map_err(constraint_conflict)?;
        let pinned_families: BTreeSet<Uuid> = restored
            .iter()
            .filter(|(_, s)| s.pinned_current)
            .map(|(_, s)| s.family_id)
            .collect();
        for family_id in pinned_families {
            recompute_family(tx, family_id).await?;
        }
    }
    Ok(())
}

/// Puts every suggestion the batch changed back to its status from before the batch. Returns the
/// changes made.
async fn restore_suggestions(
    tx: &mut Transaction<'_, Postgres>,
    changes: &BatchChanges,
    actor: SbUserId,
) -> Result<Vec<MapFamilySuggestionChange>, FamilyEditError> {
    let reverted: Vec<MapFamilySuggestionChange> = changes
        .suggestions
        .iter()
        .filter(|(_, c)| c.before != c.after)
        .map(|(&(a, b), c)| MapFamilySuggestionChange {
            map_a: SbMapId(a),
            map_b: SbMapId(b),
            before: c.after,
            after: c.before,
        })
        .collect();
    if reverted.is_empty() {
        return Ok(reverted);
    }
    let a: Vec<Uuid> = reverted.iter().map(|c| c.map_a.0).collect();
    let b: Vec<Uuid> = reverted.iter().map(|c| c.map_b.0).collect();
    let statuses: Vec<String> = reverted
        .iter()
        .map(|c| c.after.as_str().to_string())
        .collect();
    sqlx::query!(
        r#"
            UPDATE map_link_suggestions AS s
            SET status = v.status,
                decided_by = CASE WHEN v.status = 'open' THEN NULL ELSE $4::integer END,
                decided_at = CASE WHEN v.status = 'open' THEN NULL ELSE now() END
            FROM unnest($1::uuid[], $2::uuid[], $3::text[]) AS v(map_a, map_b, status)
            WHERE s.map_a = v.map_a AND s.map_b = v.map_b
        "#,
        &a,
        &b,
        &statuses,
        actor as _,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to restore suggestion statuses")?;
    Ok(reverted)
}

/// Puts every family label the batch changed back to its label from before the batch. Returns
/// the changes made, by family.
async fn restore_labels(
    tx: &mut Transaction<'_, Postgres>,
    changes: &BatchChanges,
) -> Result<Vec<(Uuid, Change<Option<String>>)>, FamilyEditError> {
    let reverted: Vec<(Uuid, Change<Option<String>>)> = changes
        .labels
        .iter()
        .filter(|(_, c)| c.before != c.after)
        .map(|(&id, c)| {
            (
                id,
                Change {
                    before: c.after.clone(),
                    after: c.before.clone(),
                },
            )
        })
        .collect();
    if reverted.is_empty() {
        return Ok(reverted);
    }
    let ids: Vec<Uuid> = reverted.iter().map(|(id, _)| *id).collect();
    let labels: Vec<Option<String>> = reverted.iter().map(|(_, c)| c.after.clone()).collect();
    sqlx::query!(
        r#"
            UPDATE map_families AS f
            SET label = v.label, updated_at = now()
            FROM unnest($1::uuid[], $2::text[]) AS v(id, label)
            WHERE f.id = v.id
        "#,
        &ids,
        &labels as _,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to restore family labels")?;
    Ok(reverted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::maps::families::history::MapFamilyMemberChange;

    fn id(n: u8) -> Uuid {
        Uuid::from_bytes([n; 16])
    }

    fn state(family: u8, parent: Option<u8>, label: &str) -> MapFamilyMemberState {
        MapFamilyMemberState {
            family_id: id(family),
            parent_id: parent.map(|p| SbMapId(id(p))),
            relation: MapFamilyRelation::Version,
            version_label: Some(label.into()),
            pinned_current: false,
            source: MapLinkSource::Moderator,
        }
    }

    fn member(
        n: u8,
        before: Option<MapFamilyMemberState>,
        after: Option<MapFamilyMemberState>,
    ) -> MapFamilyMemberChange {
        MapFamilyMemberChange {
            map_id: SbMapId(id(n)),
            before,
            after,
        }
    }

    fn entry(details: HistoryDetails) -> BatchEntry {
        BatchEntry {
            kind: MapFamilyHistoryKind::Link,
            actor: SbUserId(1),
            map_id: None,
            other_map_id: None,
            family_id: None,
            details,
        }
    }

    /// A batch that links 2 under 1 (a new family 9), then relabels 2 and rejects a suggestion.
    fn batch() -> Vec<BatchEntry> {
        let suggestion = |before, after| MapFamilySuggestionChange {
            map_a: SbMapId(id(2)),
            map_b: SbMapId(id(3)),
            before,
            after,
        };
        vec![
            entry(HistoryDetails {
                members: vec![
                    member(1, None, Some(state(9, None, "1.0"))),
                    member(2, None, Some(state(9, Some(1), "1.1"))),
                ],
                ..Default::default()
            }),
            entry(HistoryDetails {
                members: vec![member(
                    2,
                    Some(state(9, Some(1), "1.1")),
                    Some(state(9, Some(1), "1.2")),
                )],
                ..Default::default()
            }),
            entry(HistoryDetails {
                suggestions: vec![suggestion(
                    MapLinkSuggestionStatus::Open,
                    MapLinkSuggestionStatus::Rejected,
                )],
                ..Default::default()
            }),
        ]
    }

    #[test]
    fn changes_span_the_first_before_and_the_last_after() {
        let changes = BatchChanges::of(&batch());
        assert_eq!(changes.members.len(), 2);
        let two = &changes.members[&id(2)];
        assert_eq!(two.before, None);
        assert_eq!(two.after, Some(state(9, Some(1), "1.2")));
        assert_eq!(changes.family_ids(), [id(9)]);
        assert_eq!(
            changes.suggestions[&(id(2), id(3))],
            Change {
                before: MapLinkSuggestionStatus::Open,
                after: MapLinkSuggestionStatus::Rejected,
            }
        );
    }

    #[test]
    fn an_unchanged_batch_has_no_conflict() {
        let changes = BatchChanges::of(&batch());
        let members = Snapshot::from([
            (id(1), state(9, None, "1.0")),
            (id(2), state(9, Some(1), "1.2")),
        ]);
        let suggestions = HashMap::from([((id(2), id(3)), MapLinkSuggestionStatus::Rejected)]);
        assert!(!changes.conflicts(&members, &suggestions, &HashMap::new()));
    }

    #[test]
    fn later_changes_conflict() {
        let changes = BatchChanges::of(&batch());
        let members = Snapshot::from([
            (id(1), state(9, None, "1.0")),
            (id(2), state(9, Some(1), "1.3")),
        ]);
        let suggestions = HashMap::from([((id(2), id(3)), MapLinkSuggestionStatus::Rejected)]);
        assert!(changes.conflicts(&members, &suggestions, &HashMap::new()));

        let members = Snapshot::from([
            (id(1), state(9, None, "1.0")),
            (id(2), state(9, Some(1), "1.2")),
        ]);
        let reopened = HashMap::from([((id(2), id(3)), MapLinkSuggestionStatus::Open)]);
        assert!(changes.conflicts(&members, &reopened, &HashMap::new()));
    }

    #[test]
    fn an_undone_batch_conflicts_with_undoing_it_again() {
        let changes = BatchChanges::of(&batch());
        let suggestions = HashMap::from([((id(2), id(3)), MapLinkSuggestionStatus::Open)]);
        assert!(changes.conflicts(&Snapshot::new(), &suggestions, &HashMap::new()));
    }

    #[test]
    fn a_label_change_conflicts_when_the_family_is_gone() {
        let mut label = entry(HistoryDetails {
            label: Some(Change {
                before: None,
                after: Some("Lost Temple".into()),
            }),
            ..Default::default()
        });
        label.family_id = Some(id(9));
        let changes = BatchChanges::of(&[label]);
        let none = HashMap::new();
        assert!(changes.conflicts(&Snapshot::new(), &none, &HashMap::new()));
        let labels = HashMap::from([(id(9), Some("Lost Temple".to_string()))]);
        assert!(!changes.conflicts(&Snapshot::new(), &none, &labels));
    }

    #[test]
    fn a_member_cant_go_back_under_a_parent_that_left() {
        // 2 moved from under 1 in family 8 to under 3 in family 9; 1 wasn't changed by the batch.
        let changes = BatchChanges::of(&[entry(HistoryDetails {
            members: vec![member(
                2,
                Some(state(8, Some(1), "1.1")),
                Some(state(9, Some(3), "1.1")),
            )],
            ..Default::default()
        })]);
        assert_eq!(changes.map_ids(), [SbMapId(id(1)), SbMapId(id(2))]);
        let moved = Snapshot::from([(id(2), state(9, Some(3), "1.1"))]);
        assert!(changes.conflicts(&moved, &HashMap::new(), &HashMap::new()));
        let mut stayed = moved.clone();
        stayed.insert(id(1), state(8, None, "1.0"));
        assert!(!changes.conflicts(&stayed, &HashMap::new(), &HashMap::new()));
    }

    #[test]
    fn a_file_placed_since_under_a_member_leaving_its_family_conflicts() {
        let changes = BatchChanges::of(&batch());
        let suggestions = HashMap::from([((id(2), id(3)), MapLinkSuggestionStatus::Rejected)]);
        // 4 was placed under 2 after the batch put 2 in family 9, which undoing takes away
        let members = Snapshot::from([
            (id(1), state(9, None, "1.0")),
            (id(2), state(9, Some(1), "1.2")),
            (id(4), state(9, Some(2), "1.3")),
        ]);
        assert!(changes.conflicts(&members, &suggestions, &HashMap::new()));
    }

    #[test]
    fn members_changed_back_within_the_batch_arent_restored() {
        let changes = BatchChanges::of(&[
            entry(HistoryDetails {
                members: vec![member(
                    1,
                    Some(state(9, None, "1.0")),
                    Some(state(9, None, "2.0")),
                )],
                ..Default::default()
            }),
            entry(HistoryDetails {
                members: vec![member(
                    1,
                    Some(state(9, None, "2.0")),
                    Some(state(9, None, "1.0")),
                )],
                ..Default::default()
            }),
        ]);
        assert_eq!(changes.restored_members().count(), 0);
    }

    /// Applies a batch to a real database and undoes it, checking every member, suggestion and
    /// label comes back. Commits to the database, so point it at a disposable copy holding at least
    /// two families (one of exactly two members), three maps in no family, and user 1:
    ///
    /// `SB_FAMILY_UNDO_DB=postgres://... cargo test --lib -- --ignored undo_restores_a_batch`
    #[tokio::test]
    #[ignore]
    async fn undo_restores_a_batch() {
        use crate::maps::families::edit;

        let db = sqlx::PgPool::connect(&std::env::var("SB_FAMILY_UNDO_DB").unwrap())
            .await
            .unwrap();
        let user = SbUserId(1);
        let source = MapLinkSource::Moderator;

        // A family of exactly two members, which the batch empties by moving its root away, and a
        // member of another family to move it under.
        let small = sqlx::query!(
            r#"
                SELECT family_id, map_id as "map_id: SbMapId"
                FROM map_family_members
                WHERE relation = 'root' AND family_id IN (
                    SELECT family_id FROM map_family_members GROUP BY family_id
                    HAVING count(*) = 2
                )
                LIMIT 1
            "#
        )
        .fetch_one(&db)
        .await
        .unwrap();
        let small_child: SbMapId = sqlx::query_scalar!(
            r#"
                SELECT map_id as "map_id: SbMapId" FROM map_family_members
                WHERE family_id = $1 AND relation <> 'root'
            "#,
            small.family_id,
        )
        .fetch_one(&db)
        .await
        .unwrap();
        let big = sqlx::query!(
            r#"
                SELECT family_id, map_id as "map_id: SbMapId"
                FROM map_family_members
                WHERE family_id <> $1
                ORDER BY map_id
                LIMIT 1
            "#,
            small.family_id,
        )
        .fetch_one(&db)
        .await
        .unwrap();
        let free: Vec<SbMapId> = sqlx::query_scalar!(
            r#"
                SELECT id as "id: SbMapId" FROM maps
                WHERE id NOT IN (SELECT map_id FROM map_family_members)
                ORDER BY id
                LIMIT 3
            "#
        )
        .fetch_all(&db)
        .await
        .unwrap();
        let (sa, sb) = edit::ordered(free[1], free[2]);
        sqlx::query!(
            r#"
                INSERT INTO map_link_suggestions (map_a, map_b, name_match, verdict,
                    verdict_rules_version, status, created_at)
                VALUES ($1, $2, false, '{}', 1, 'open', now())
                ON CONFLICT (map_a, map_b) DO UPDATE SET status = 'open', decided_by = NULL,
                    decided_at = NULL
            "#,
            sa as _,
            sb as _,
        )
        .execute(&db)
        .await
        .unwrap();

        // The small family's label only lives in history once the family is gone.
        let mut tx = db.begin().await.unwrap();
        edit::set_label(&mut tx, small.family_id, Some("Small".into()), user)
            .await
            .unwrap();
        tx.commit().await.unwrap();

        let families = [small.family_id, big.family_id];
        let maps = [
            small.map_id,
            small_child,
            big.map_id,
            free[0],
            free[1],
            free[2],
        ];
        let state = async |db: &sqlx::PgPool| {
            let mut tx = db.begin().await.unwrap();
            let members = history::snapshot(&mut tx, &families, &maps).await.unwrap();
            let labels: Vec<(Uuid, Option<String>)> = sqlx::query!(
                "SELECT id, label FROM map_families WHERE id = ANY($1) ORDER BY id",
                &families,
            )
            .fetch_all(&mut *tx)
            .await
            .unwrap()
            .into_iter()
            .map(|r| (r.id, r.label))
            .collect();
            let status = sqlx::query_scalar!(
                "SELECT status FROM map_link_suggestions WHERE map_a = $1 AND map_b = $2",
                sa as _,
                sb as _,
            )
            .fetch_one(&mut *tx)
            .await
            .unwrap();
            (members, labels, status)
        };
        let original = state(&db).await;

        let mut tx = db.begin().await.unwrap();
        for request in [
            edit::LinkRequest {
                map_id: small.map_id,
                parent_id: big.map_id,
                relation: MapFamilyRelation::Version,
                version_label: None,
            },
            edit::LinkRequest {
                map_id: free[0],
                parent_id: big.map_id,
                relation: MapFamilyRelation::Variant,
                version_label: Some(Some("new".into())),
            },
        ] {
            edit::link(&mut tx, &request, source, user).await.unwrap();
        }
        edit::update_member(
            &mut tx,
            small_child,
            Some(Some("9.9".into())),
            None,
            source,
            user,
        )
        .await
        .unwrap();
        edit::decide_suggestion(
            &mut tx,
            free[1],
            free[2],
            edit::MapLinkSuggestionDecision::Rejected,
            source,
            user,
        )
        .await
        .unwrap();
        edit::set_label(&mut tx, big.family_id, Some("Big".into()), user)
            .await
            .unwrap();
        let batch = history::first_entry_of_transaction(&mut tx)
            .await
            .unwrap()
            .unwrap();
        tx.commit().await.unwrap();
        let applied = state(&db).await;
        assert_ne!(applied, original);
        assert!(!applied.1.iter().any(|(id, _)| *id == small.family_id));

        let mut tx = db.begin().await.unwrap();
        assert_eq!(history::load_batch(&mut tx, batch).await.unwrap().len(), 5);
        let undo_entry = undo(&mut tx, batch, source, user).await.unwrap().unwrap();
        tx.commit().await.unwrap();
        assert_eq!(state(&db).await, original);

        let mut tx = db.begin().await.unwrap();
        assert!(matches!(
            undo(&mut tx, batch, source, user).await,
            Err(FamilyEditError::Conflict)
        ));
        drop(tx);

        let mut tx = db.begin().await.unwrap();
        undo(&mut tx, undo_entry, source, user).await.unwrap();
        tx.commit().await.unwrap();
        assert_eq!(state(&db).await, applied);

        // Put the database back as it was.
        let mut tx = db.begin().await.unwrap();
        undo(&mut tx, batch, source, user).await.unwrap();
        tx.commit().await.unwrap();
        assert_eq!(state(&db).await, original);
    }
}
