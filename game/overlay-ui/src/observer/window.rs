//! Layout preferences and collapsible observer windows.

use egui::{Align2, Area, Context, Id, Order, Rect, Ui, vec2};
use serde::{Deserialize, Serialize};

use super::Wing;
use crate::kit::{motion, tiers, widgets};
use crate::shell::Panel;

/// A window's remembered layout. Positions are overlay points, independent of display scaling.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct WindowPrefs {
    pub collapsed: bool,
    /// `None` leaves placement to the automatic layout.
    pub position: Option<[i32; 2]>,
}

impl WindowPrefs {
    pub(crate) fn height(self, expanded: f32) -> f32 {
        if self.collapsed {
            collapsed_height()
        } else {
            expanded
        }
    }

    pub(crate) fn floating(self) -> bool {
        self.position.is_some()
    }
}

pub(crate) fn collapsed_height() -> f32 {
    tiers::PANEL_MARGIN_HEIGHT + widgets::PANEL_HEADER_HEIGHT
}

/// Saved layouts are named so adding a panel does not shift another panel's saved position.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct WindowLayouts {
    pub economy: WindowPrefs,
    pub military: WindowPrefs,
    pub graphs: WindowPrefs,
    pub timeline: WindowPrefs,
    pub matchup: WindowPrefs,
    pub map_control: WindowPrefs,
    pub production: WindowPrefs,
    pub control_groups: WindowPrefs,
    pub selection: WindowPrefs,
    pub minimap: WindowPrefs,
    pub transport: WindowPrefs,
    pub dock: WindowPrefs,
    pub team_left: WindowPrefs,
    pub team_right: WindowPrefs,
}

/// Visibility and layout for one frame of a window.
pub struct Window<'a> {
    pub shown: bool,
    pub prefs: &'a mut WindowPrefs,
}

/// A window's automatic placement.
pub(crate) struct WingPlacement {
    pub wing: Wing,
    pub top: f32,
    pub width: f32,
}

/// What a window drew, and whether its close button was pressed.
pub struct WindowOutcome<R> {
    pub rect: Rect,
    pub closed: bool,
    pub inner: R,
}

impl Window<'_> {
    pub(crate) fn show<R: Default>(
        self,
        ctx: &Context,
        id: Id,
        place: WingPlacement,
        panel: Panel,
        title: &str,
        body: impl FnOnce(&mut Ui) -> R,
    ) -> Option<WindowOutcome<R>> {
        let (align, offset_x) = match place.wing {
            Wing::Left => (Align2::LEFT_TOP, super::WING_MARGIN),
            Wing::Right { inset } => (Align2::RIGHT_TOP, -(super::WING_MARGIN + inset)),
        };
        let area = Area::new(id).order(Order::Foreground).movable(false);
        let area = area.anchor(align, vec2(offset_x, place.top));
        let collapsed = self.prefs.collapsed;
        let inner = motion::presence_area(ctx, id.with("presence"), self.shown, area, |ui| {
            tiers::tier0_panel(ui, |ui| {
                ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
                ui.set_width(tiers::panel_content_width(place.width));
                let header =
                    widgets::window_header(ui, title, panel.key_label().as_deref(), collapsed);
                let content = if collapsed { R::default() } else { body(ui) };
                (header, content)
            })
            .inner
        })?;
        let (header, content) = inner.inner;
        if header.title.clicked() {
            self.prefs.collapsed = !collapsed;
        }
        Some(WindowOutcome {
            rect: inner.response.rect,
            closed: header.closed,
            inner: content,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kit::surfaces;
    use egui::{Event, Modifiers, PointerButton, Pos2, Sense, pos2};

    const WINDOW_ID: &str = "sb_economy_panel";

    struct Harness {
        ctx: Context,
        prefs: WindowPrefs,
        time: f64,
        screen: Rect,
        rect: Rect,
    }

    impl Harness {
        fn new() -> Self {
            let ctx = Context::default();
            crate::install_fonts_and_style(&ctx, &crate::DynamicFonts::default());
            let mut harness = Self {
                ctx,
                prefs: WindowPrefs::default(),
                time: 0.0,
                screen: Rect::from_min_size(Pos2::ZERO, vec2(1280.0, 720.0)),
                rect: Rect::NOTHING,
            };
            for _ in 0..6 {
                harness.frame(Vec::new());
            }
            harness
        }

        fn frame(&mut self, events: Vec<Event>) -> WindowOutcome<bool> {
            self.time += 0.25;
            self.ctx.begin_pass(egui::RawInput {
                screen_rect: Some(self.screen),
                time: Some(self.time),
                events,
                ..Default::default()
            });
            surfaces::begin(
                &self.ctx,
                vec![surfaces::Config {
                    id: Id::new(WINDOW_ID),
                    position: self.prefs.position,
                    blocked: false,
                }],
            );
            let outcome = Window {
                shown: true,
                prefs: &mut self.prefs,
            }
            .show(
                &self.ctx,
                Id::new(WINDOW_ID),
                WingPlacement {
                    wing: Wing::Left,
                    top: 100.0,
                    width: 400.0,
                },
                Panel::Economy,
                "Economy",
                |ui| {
                    ui.allocate_exact_size(vec2(376.0, 120.0), Sense::click())
                        .1
                        .clicked()
                },
            )
            .unwrap();
            self.rect = outcome.rect;
            let _ = surfaces::finish(&self.ctx);
            self.ctx.end_pass().textures_delta.clear();
            outcome
        }

        fn title(&self) -> Pos2 {
            self.rect.min + vec2(80.0, 20.0)
        }

        fn button(
            &mut self,
            pos: Pos2,
            button: PointerButton,
            pressed: bool,
        ) -> WindowOutcome<bool> {
            self.frame(vec![
                Event::PointerMoved(pos),
                Event::PointerButton {
                    pos,
                    button,
                    pressed,
                    modifiers: Modifiers::NONE,
                },
            ])
        }

        fn click(&mut self, pos: Pos2, button: PointerButton) -> WindowOutcome<bool> {
            self.button(pos, button, true);
            self.button(pos, button, false)
        }
    }

    #[test]
    fn clicking_the_title_folds_the_body_and_clicking_again_restores_it() {
        let mut harness = Harness::new();
        let expanded = harness.rect.height();
        harness.click(harness.title(), PointerButton::Primary);
        assert!(harness.prefs.collapsed);
        harness.frame(Vec::new());
        assert_eq!(harness.rect.height(), collapsed_height());
        harness.click(harness.title(), PointerButton::Primary);
        assert!(!harness.prefs.collapsed);
        harness.frame(Vec::new());
        assert_eq!(harness.rect.height(), expanded);
    }

    #[test]
    fn closing_the_badge_does_not_fold_the_window() {
        let mut harness = Harness::new();
        let close = pos2(harness.rect.right() - 22.0, harness.rect.top() + 20.0);
        let outcome = harness.click(close, PointerButton::Primary);
        assert!(outcome.closed);
        assert!(!harness.prefs.collapsed);
        assert_eq!(harness.prefs.position, None);
    }

    #[test]
    fn body_clicks_keep_their_action_without_moving_or_folding_the_window() {
        let mut harness = Harness::new();
        let body = harness.rect.center() + vec2(0.0, 20.0);
        assert!(harness.click(body, PointerButton::Primary).inner);
        assert_eq!(harness.prefs, WindowPrefs::default());
    }

    #[test]
    fn layouts_round_trip_and_missing_layouts_keep_the_automatic_positions() {
        let mut prefs = crate::shell::PanelPrefs::default();
        prefs.windows.economy = WindowPrefs {
            collapsed: true,
            position: Some([240, 160]),
        };
        let saved = serde_json::to_string(&prefs).unwrap();
        assert_eq!(
            serde_json::from_str::<crate::shell::PanelPrefs>(&saved).unwrap(),
            prefs
        );
        let legacy: crate::shell::PanelPrefs = serde_json::from_str(r#"{"economy":true}"#).unwrap();
        assert_eq!(legacy.windows, WindowLayouts::default());
        assert!(legacy.economy);
    }
}
