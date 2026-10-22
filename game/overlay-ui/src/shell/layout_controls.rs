//! Modifier gestures shared by every observer surface, including headerless panels.
use super::HitRect;
use crate::kit::{surfaces, theme};
use crate::observer::{WindowLayouts, WindowPrefs, manipulation};
use egui::{Context, CursorIcon, Id, PointerButton, Pos2, Rect, Stroke, StrokeKind};

const SNAP: f32 = 10.0;
fn entries(w: &mut WindowLayouts) -> [(Id, &mut WindowPrefs); 14] {
    [
        (Id::new("sb_economy_panel"), &mut w.economy),
        (Id::new("sb_military_panel"), &mut w.military),
        (Id::new("sb_graphs_panel"), &mut w.graphs),
        (Id::new("sb_timeline_panel"), &mut w.timeline),
        (Id::new("sb_matchup_bar"), &mut w.matchup),
        (Id::new("sb_map_control_bar"), &mut w.map_control),
        (Id::new("sb_production_panel"), &mut w.production),
        (Id::new("sb_control_groups_panel"), &mut w.control_groups),
        (Id::new("sb_selection_panel"), &mut w.selection),
        (Id::new("sb_minimap_frame"), &mut w.minimap),
        (Id::new("sb_replay_transport"), &mut w.transport),
        (Id::new("sb_obs_dock"), &mut w.dock),
        (Id::new(("sb_team_card", 0_usize)), &mut w.team_left),
        (Id::new(("sb_team_card", 1_usize)), &mut w.team_right),
    ]
}

#[derive(Clone, Copy)]
struct Drag {
    id: Id,
    start: Rect,
    pointer: Pos2,
}
#[derive(Default)]
pub(super) struct LayoutControls {
    previous: Vec<surfaces::Surface>,
    active: Option<Drag>,
    followers: Vec<(Id, Rect)>,
    enabled: bool,
}
impl LayoutControls {
    pub fn begin(&mut self, ctx: &Context, windows: &mut WindowLayouts, enabled: bool) {
        self.enabled = enabled;
        if !enabled {
            self.active = None;
            self.followers.clear();
        }
        let (pointer, modifiers, pressed, reset) = ctx.input(|i| {
            (
                i.pointer.interact_pos(),
                i.modifiers,
                i.pointer.button_pressed(PointerButton::Primary),
                i.pointer.button_pressed(PointerButton::Secondary),
            )
        });
        let hovered = pointer.and_then(|pos| {
            let top = ctx.layer_id_at(pos);
            if top.is_some_and(|layer| layer.order > egui::Order::Foreground) {
                return None;
            }
            let contains = |s: &&surfaces::Surface| s.rect.contains(pos);
            self.previous
                .iter()
                .rev()
                .filter(contains)
                .find(|s| Some(s.layer) == top)
                .or_else(|| self.previous.iter().rev().find(contains))
                .copied()
        });
        if enabled
            && self.active.is_none()
            && let Some(surface) = hovered
        {
            if modifiers.alt && reset {
                if let Some((_, prefs)) = entries(windows)
                    .into_iter()
                    .find(|(id, _)| *id == surface.layer.id)
                {
                    prefs.position = None;
                }
            } else if pressed && modifiers.alt {
                self.followers.clear();
                let rects: Vec<_> = self.previous.iter().map(|s| s.layout_rect).collect();
                if let Some(root) = self.previous.iter().position(|s| s.layer == surface.layer) {
                    self.followers = manipulation::attached_chain(root, &rects)
                        .into_iter()
                        .filter(|&index| index != root)
                        .map(|index| (self.previous[index].layer.id, rects[index]))
                        .collect();
                }
                ctx.move_to_top(surface.layer);
                self.active = Some(Drag {
                    id: surface.layer.id,
                    start: surface.layout_rect,
                    pointer: pointer.unwrap(),
                });
            }
        }
        if let Some(drag) = self.active
            && let Some(pointer) = pointer
        {
            let rect = {
                let targets: Vec<_> = self
                    .previous
                    .iter()
                    .filter(|s| {
                        s.layer.id != drag.id
                            && !self.followers.iter().any(|(id, _)| *id == s.layer.id)
                    })
                    .map(|s| s.rect)
                    .collect();
                let moved = manipulation::snap_rect(
                    drag.start.translate(pointer - drag.pointer),
                    &targets,
                    ctx.viewport_rect(),
                    SNAP,
                );
                let delta = moved.min - drag.start.min;
                let bounds = self
                    .followers
                    .iter()
                    .fold(drag.start, |bounds, (_, rect)| bounds.union(*rect));
                let reachable =
                    manipulation::snap_rect(bounds.translate(delta), &[], ctx.viewport_rect(), 0.0);
                drag.start.translate(reachable.min - bounds.min)
            };
            let delta = rect.min - drag.start.min;
            for (id, prefs) in entries(windows) {
                if let Some((_, start)) =
                    self.followers.iter().find(|(follower, _)| *follower == id)
                {
                    let moved = start.translate(delta);
                    prefs.position =
                        Some([moved.left().round() as i32, moved.top().round() as i32]);
                }
            }
            if let Some((_, prefs)) = entries(windows).into_iter().find(|(id, _)| *id == drag.id) {
                prefs.position = Some([rect.left().round() as i32, rect.top().round() as i32]);
            }
        }
        let blocked = enabled && (self.active.is_some() || modifiers.alt);
        surfaces::begin(
            ctx,
            entries(windows)
                .into_iter()
                .map(|(id, p)| surfaces::Config {
                    id,
                    position: p.position,
                    blocked,
                })
                .collect(),
        );
        if enabled
            && let Some(surface) = hovered
            && (modifiers.alt || self.active.is_some())
        {
            ctx.set_cursor_icon(CursorIcon::Move);
            ctx.layer_painter(egui::LayerId::new(
                egui::Order::Tooltip,
                Id::new("observer_layout_outline"),
            ))
            .rect_stroke(
                surface.rect,
                theme::radius(theme::RADIUS_PANEL),
                Stroke::new(1.0, theme::ACCENT),
                StrokeKind::Outside,
            );
        }
    }
    pub fn finish(
        &mut self,
        ctx: &Context,
        hits: &mut Vec<HitRect>,
        minimap: Option<Rect>,
    ) -> Option<Rect> {
        let surfaces = surfaces::finish(ctx);
        for hit in hits.iter_mut() {
            if let Some(s) = surfaces
                .iter()
                .find(|s| s.source == hit.rect && s.layer.id != Id::new("sb_minimap_frame"))
            {
                hit.rect = s.transform * hit.rect;
            }
        }
        let minimap = minimap.map(|rect| {
            surfaces
                .iter()
                .find(|s| s.layer.id == Id::new("sb_minimap_frame"))
                .map_or(rect, |s| s.transform * rect)
        });
        if self.enabled {
            hits.extend(
                surfaces
                    .iter()
                    .filter(|s| s.shown)
                    .map(|s| HitRect::move_only(s.rect)),
            );
        }
        self.previous = surfaces.into_iter().filter(|s| s.shown).collect();
        if !ctx.input(|i| i.pointer.primary_down()) {
            self.active = None;
            self.followers.clear();
        }
        minimap
    }
}

#[cfg(test)]
mod tests;
