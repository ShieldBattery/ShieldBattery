use super::LayoutControls;
use crate::kit::{motion, surfaces, widgets};
use crate::observer::WindowLayouts;
use crate::shell::HitRect;
use egui::{
    Area, Color32, Context, Event, Id, LayerId, Modifiers, Order, PointerButton, Pos2, RawInput,
    Rect, Sense, pos2, vec2,
};

const PRODUCTION: &str = "sb_production_panel";
const ECONOMY: &str = "sb_economy_panel";
const MINIMAP: &str = "sb_minimap_frame";

struct Frame {
    production_clicked: bool,
    hits: Vec<HitRect>,
}

struct ScrubFrame {
    source: Rect,
    clicked_marker: Option<usize>,
}

struct Harness {
    ctx: Context,
    controls: LayoutControls,
    windows: WindowLayouts,
    screen: Rect,
    time: f64,
}

impl Harness {
    fn new() -> Self {
        let ctx = Context::default();
        crate::install_fonts_and_style(&ctx, &crate::DynamicFonts::default());
        let mut result = Self {
            ctx,
            controls: LayoutControls::default(),
            windows: WindowLayouts::default(),
            screen: Rect::from_min_size(Pos2::ZERO, vec2(800.0, 600.0)),
            time: 0.0,
        };
        result.settle();
        result
    }

    fn settle(&mut self) {
        for _ in 0..6 {
            self.frame(Modifiers::NONE, []);
        }
    }

    fn frame(&mut self, modifiers: Modifiers, events: impl IntoIterator<Item = Event>) -> Frame {
        self.frame_with_enabled(true, modifiers, events)
    }

    fn frame_with_enabled(
        &mut self,
        enabled: bool,
        modifiers: Modifiers,
        events: impl IntoIterator<Item = Event>,
    ) -> Frame {
        self.time += 0.25;
        self.ctx.begin_pass(RawInput {
            screen_rect: Some(self.screen),
            time: Some(self.time),
            events: std::iter::once(Event::ModifiersChanged(modifiers))
                .chain(events)
                .collect(),
            ..Default::default()
        });
        self.controls.begin(&self.ctx, &mut self.windows, enabled);
        let (_, production_clicked) = draw_panel(
            &self.ctx,
            Id::new(PRODUCTION),
            pos2(100.0, 100.0),
            vec2(160.0, 100.0),
        );
        let _ = draw_panel(
            &self.ctx,
            Id::new(ECONOMY),
            pos2(350.0, 100.0),
            vec2(160.0, 100.0),
        );
        let (minimap, _) = draw_panel(
            &self.ctx,
            Id::new(MINIMAP),
            pos2(100.0, 320.0),
            vec2(120.0, 120.0),
        );
        let mut hits = vec![HitRect::new(minimap)];
        self.controls.finish(&self.ctx, &mut hits, Some(minimap));
        let mut output = self.ctx.end_pass();
        output.textures_delta.clear();
        Frame {
            production_clicked,
            hits,
        }
    }

    fn panel_rect(&self, id: &str) -> Rect {
        self.controls
            .previous
            .iter()
            .find(|surface| surface.layer.id == Id::new(id))
            .unwrap()
            .rect
    }

    fn production(&self) -> Rect {
        self.panel_rect(PRODUCTION)
    }

    fn economy(&self) -> Rect {
        self.panel_rect(ECONOMY)
    }

    fn minimap(&self) -> Rect {
        self.panel_rect(MINIMAP)
    }

    fn pointer_down(&mut self, pos: Pos2, modifiers: Modifiers) -> Frame {
        self.frame(
            modifiers,
            [
                Event::PointerMoved(pos),
                Event::PointerButton {
                    pos,
                    button: PointerButton::Primary,
                    pressed: true,
                    modifiers,
                },
            ],
        )
    }

    fn pointer_move(&mut self, pos: Pos2, modifiers: Modifiers) -> Frame {
        self.frame(modifiers, [Event::PointerMoved(pos)])
    }

    fn pointer_up(&mut self, pos: Pos2, modifiers: Modifiers) -> Frame {
        self.frame(
            modifiers,
            [
                Event::PointerMoved(pos),
                Event::PointerButton {
                    pos,
                    button: PointerButton::Primary,
                    pressed: false,
                    modifiers,
                },
            ],
        )
    }

    fn alt_drag(&mut self, start: Pos2, end: Pos2) -> Frame {
        self.pointer_down(start, Modifiers::ALT);
        self.pointer_move(end, Modifiers::ALT);
        self.pointer_up(end, Modifiers::ALT)
    }

    fn scrub_frame(
        &mut self,
        modifiers: Modifiers,
        events: impl IntoIterator<Item = Event>,
    ) -> ScrubFrame {
        self.time += 0.25;
        self.ctx.begin_pass(RawInput {
            screen_rect: Some(self.screen),
            time: Some(self.time),
            events: std::iter::once(Event::ModifiersChanged(modifiers))
                .chain(events)
                .collect(),
            ..Default::default()
        });
        self.controls.begin(&self.ctx, &mut self.windows, true);
        let inner = motion::presence_area(
            &self.ctx,
            Id::new(PRODUCTION).with("presence"),
            true,
            Area::new(Id::new(PRODUCTION))
                .fixed_pos(pos2(100.0, 100.0))
                .order(Order::Foreground)
                .movable(false),
            |ui| {
                widgets::scrub_track_marked(
                    ui,
                    0.0,
                    vec2(200.0, 40.0),
                    &[widgets::TrackMarker {
                        fraction: 0.5,
                        color: Color32::WHITE,
                    }],
                )
            },
        )
        .unwrap();
        let mut hits = Vec::new();
        self.controls.finish(&self.ctx, &mut hits, None);
        let mut output = self.ctx.end_pass();
        output.textures_delta.clear();
        ScrubFrame {
            source: inner.inner.response.rect,
            clicked_marker: inner.inner.clicked_marker,
        }
    }
}

fn draw_panel(ctx: &Context, id: Id, origin: Pos2, size: egui::Vec2) -> (Rect, bool) {
    let inner = motion::presence_area(
        ctx,
        id.with("presence"),
        true,
        Area::new(id)
            .fixed_pos(origin)
            .order(Order::Foreground)
            .movable(false),
        |ui| ui.allocate_exact_size(size, Sense::click()).1.clicked(),
    )
    .unwrap();
    (inner.response.rect, inner.inner)
}

#[test]
fn unmodified_drag_leaves_the_layout_automatic_but_alt_drag_moves_without_clicking() {
    let mut harness = Harness::new();
    let body = harness.production().center();
    let end = body + vec2(55.0, 60.0);

    harness.pointer_down(body, Modifiers::NONE);
    harness.pointer_move(end, Modifiers::NONE);
    let normal = harness.pointer_up(end, Modifiers::NONE);
    assert_eq!(harness.windows.production.position, None);
    assert!(!normal.production_clicked);

    let moved = harness.alt_drag(harness.production().center(), end);
    assert_eq!(harness.windows.production.position, Some([155, 160]));
    assert!(!moved.production_clicked);
}

#[test]
fn an_alt_drag_stays_active_after_alt_is_released() {
    let mut harness = Harness::new();
    let start = harness.production().center();
    let end = start + vec2(55.0, 60.0);

    harness.pointer_down(start, Modifiers::ALT);
    harness.pointer_move(end, Modifiers::NONE);
    let moved = harness.pointer_up(end, Modifiers::NONE);

    assert_eq!(harness.windows.production.position, Some([155, 160]));
    assert!(!moved.production_clicked);
}

#[test]
fn alt_drag_snaps_to_a_nearby_panel_but_not_beyond_the_threshold() {
    let mut snapped = Harness::new();
    let start = snapped.production().center();
    snapped.alt_drag(start, start + vec2(80.0, 0.0));
    assert_eq!(
        snapped.windows.production.position,
        Some([(snapped.economy().left() - 160.0) as i32, 100]),
    );

    let mut unsnapped = Harness::new();
    let start = unsnapped.production().center();
    unsnapped.alt_drag(start, start + vec2(55.0, 0.0));
    assert_eq!(unsnapped.windows.production.position, Some([155, 100]));
}

#[test]
fn layout_only_minimap_hits_take_alt_and_leave_ordinary_and_ctrl_input_alone() {
    let mut harness = Harness::new();
    let frame = harness.frame(Modifiers::NONE, []);
    let minimap = harness.panel_rect(MINIMAP);
    let layout_hit = frame
        .hits
        .iter()
        .copied()
        .find(|hit| hit.layout_only && hit.rect == minimap)
        .unwrap();
    let center = minimap.center();
    let edge = pos2(minimap.left() + 4.0, minimap.center().y);

    assert!(!layout_hit.contains_pointer(center, Modifiers::NONE));
    assert!(!layout_hit.contains_pointer(center, Modifiers::CTRL));
    assert!(!layout_hit.contains_pointer(edge, Modifiers::CTRL));
    assert!(layout_hit.contains_pointer(center, Modifiers::ALT));
}

#[test]
fn minimap_only_allows_alt_move() {
    let mut harness = Harness::new();

    let minimap = harness.minimap();
    let edge = pos2(minimap.right(), minimap.center().y);
    harness.pointer_down(edge, Modifiers::CTRL);
    harness.pointer_move(edge + vec2(100.0, 0.0), Modifiers::CTRL);
    harness.pointer_up(edge + vec2(100.0, 0.0), Modifiers::CTRL);

    assert_eq!(harness.windows.minimap.position, None);

    let start = harness.minimap().center();
    harness.alt_drag(start, start + vec2(55.0, 60.0));

    assert_eq!(harness.windows.minimap.position, Some([155, 380]));
}

#[test]
fn alt_secondary_resets_the_saved_position() {
    let mut harness = Harness::new();
    harness.windows.production.position = Some([240, 180]);
    harness.settle();
    let body = harness.production().center();

    harness.frame(
        Modifiers::ALT,
        [
            Event::PointerMoved(body),
            Event::PointerButton {
                pos: body,
                button: PointerButton::Secondary,
                pressed: true,
                modifiers: Modifiers::ALT,
            },
        ],
    );

    assert_eq!(harness.windows.production.position, None);
}

#[test]
fn saved_transforms_remain_applied_while_layout_controls_are_disabled() {
    let mut harness = Harness::new();
    harness.windows.production.position = Some([240, 180]);

    let frame = harness.frame_with_enabled(false, Modifiers::NONE, []);
    let rect = harness.production();
    assert_eq!(rect.min, pos2(240.0, 180.0));
    assert_eq!(rect.size(), vec2(160.0, 100.0));
    assert!(!frame.hits.iter().any(|hit| hit.layout_only));
}

#[test]
fn animated_surfaces_use_the_full_layer_transform_for_visual_hits() {
    let ctx = Context::default();
    ctx.begin_pass(RawInput {
        screen_rect: Some(Rect::from_min_size(Pos2::ZERO, vec2(800.0, 600.0))),
        ..Default::default()
    });
    let mut controls = LayoutControls::default();
    let mut windows = WindowLayouts::default();
    controls.begin(&ctx, &mut windows, true);

    let id = Id::new(PRODUCTION);
    let layer = LayerId::new(Order::Foreground, id);
    let source = Rect::from_min_size(pos2(100.0, 200.0), vec2(80.0, 40.0));
    surfaces::begin(
        &ctx,
        vec![surfaces::Config {
            id,
            position: Some([240, 180]),
            blocked: false,
        }],
    );
    surfaces::transform(&ctx, layer, source, vec2(0.0, -10.0), true);
    let global_popup = source.shrink(5.0);
    let mut hits = vec![HitRect::new(source), HitRect::new(global_popup)];
    controls.finish(&ctx, &mut hits, None);
    let mut output = ctx.end_pass();
    output.textures_delta.clear();

    let surface = controls.previous[0];
    assert_eq!(
        surface.layout_rect,
        Rect::from_min_size(pos2(240.0, 180.0), vec2(80.0, 40.0))
    );
    assert_eq!(
        surface.rect,
        Rect::from_min_size(pos2(240.0, 170.0), vec2(80.0, 40.0))
    );
    assert_eq!(surface.rect, surface.transform * source);
    assert_eq!(hits[0].rect, surface.rect);
    assert_eq!(hits[1].rect, global_popup);
    assert!(
        hits.iter()
            .any(|hit| hit.layout_only && hit.rect == surface.rect)
    );
}

#[test]
fn transformed_scrub_track_maps_the_global_press_origin_back_to_its_marker() {
    let mut harness = Harness::new();
    harness.windows.production.position = Some([240, 180]);
    let initial = harness.scrub_frame(Modifiers::NONE, []);
    let transform = harness
        .controls
        .previous
        .iter()
        .find(|surface| surface.layer.id == Id::new(PRODUCTION))
        .unwrap()
        .transform;
    let marker = transform * pos2(initial.source.center().x, initial.source.top() + 10.0);

    harness.scrub_frame(
        Modifiers::NONE,
        [
            Event::PointerMoved(marker),
            Event::PointerButton {
                pos: marker,
                button: PointerButton::Primary,
                pressed: true,
                modifiers: Modifiers::NONE,
            },
        ],
    );
    let released = harness.scrub_frame(
        Modifiers::NONE,
        [
            Event::PointerMoved(marker),
            Event::PointerButton {
                pos: marker,
                button: PointerButton::Primary,
                pressed: false,
                modifiers: Modifiers::NONE,
            },
        ],
    );

    assert_eq!(released.clicked_marker, Some(0));
}

#[test]
fn a_smaller_viewport_keeps_large_moved_panels_reachable() {
    let mut harness = Harness::new();
    harness.screen = Rect::from_min_size(pos2(0.0, 0.0), vec2(200.0, 140.0));
    harness.settle();
    let body = harness.production().center();
    harness.alt_drag(body, pos2(-1_000.0, 1_000.0));
    harness.frame(Modifiers::NONE, []);

    let rect = harness.production();
    assert!(rect.right() >= harness.screen.left() + 32.0);
    assert!(rect.top() <= harness.screen.bottom() - 32.0);
}

#[test]
fn dragging_the_top_carries_a_saved_flush_chain() {
    let mut harness = Harness::new();
    harness.windows.economy.position = Some([100, 200]);
    harness.windows.minimap.position = Some([100, 300]);
    harness.settle();
    let start = harness.production().center();
    harness.alt_drag(start, start + vec2(55.0, 60.0));
    assert_eq!(harness.windows.production.position, Some([155, 160]));
    assert_eq!(harness.windows.economy.position, Some([155, 260]));
    assert_eq!(harness.windows.minimap.position, Some([155, 360]));
    assert_eq!(harness.production().bottom(), harness.economy().top());
    assert_eq!(harness.economy().bottom(), harness.minimap().top());
}

#[test]
fn dragging_a_lower_window_detaches_its_subchain() {
    let mut harness = Harness::new();
    harness.windows.economy.position = Some([100, 200]);
    harness.windows.minimap.position = Some([100, 300]);
    harness.settle();
    let start = harness.economy().center();
    harness.alt_drag(start, start + vec2(70.0, 30.0));
    assert_eq!(harness.windows.production.position, None);
    assert_eq!(harness.production().min, pos2(100.0, 100.0));
    assert_eq!(harness.windows.economy.position, Some([170, 230]));
    assert_eq!(harness.windows.minimap.position, Some([170, 330]));
}

#[test]
fn dragging_a_chain_to_the_screen_edge_keeps_its_windows_joined() {
    let mut harness = Harness::new();
    harness.windows.economy.position = Some([100, 200]);
    harness.windows.minimap.position = Some([100, 300]);
    harness.settle();
    let start = harness.production().center();
    harness.alt_drag(start, start + vec2(0.0, 500.0));
    assert_eq!(harness.production().bottom(), harness.economy().top());
    assert_eq!(harness.economy().bottom(), harness.minimap().top());
    assert_eq!(harness.minimap().bottom(), harness.screen.bottom());
}

#[test]
fn ctrl_drag_keeps_panel_dimensions_and_placement_unchanged() {
    let mut harness = Harness::new();
    let original = harness.production();
    let edge = original.right_center();
    harness.pointer_down(edge, Modifiers::CTRL);
    harness.pointer_move(edge + vec2(80.0, 40.0), Modifiers::CTRL);
    harness.pointer_up(edge + vec2(80.0, 40.0), Modifiers::CTRL);
    assert_eq!(harness.windows.production.position, None);
    assert_eq!(harness.production(), original);
}
