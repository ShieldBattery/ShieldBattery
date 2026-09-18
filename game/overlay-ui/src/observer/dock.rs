//! The observer dock: the one place a watcher can see what they are being shown and change it
//! without knowing a key.
//!
//! It hangs off the right edge of the screen at the kit's ambient tier, in two forms of the same
//! list. **Collapsed** it is a strip of keycaps, one per surface, lit for the ones that are on — a
//! reminder for someone who already knows the keys, taking as little of the screen as a control can.
//! **Expanded** it is the control rail: the same list with its names spelled out, plus the three
//! presets, for someone who does not.
//!
//! The list is the shell's panel table rather than a list of its own, so a surface built later
//! appears here the day its toggle does, and one that does not exist yet is not advertised.
//!
//! It is anchored to the middle of the screen's right edge rather than to a fixed height: the list
//! grows with the panels that exist and with what is being watched, and a fixed top would sooner or
//! later push the presets into the console band the game's own interface owns.

use egui::{
    Align, Align2, Area, Context, Id, Order, Rect, Sense, Shape, Stroke, StrokeKind, Ui, pos2, vec2,
};

use crate::kit::text::{self, BodyWeight};
use crate::kit::tiers::gradient_round_rect;
use crate::kit::widgets;
use crate::kit::{motion, theme, tiers};
use crate::observer::{centred, paint_text};
use crate::shell::{Action, Hotkeys, Mode, Panel, PanelPrefs, PanelPreset};
use crate::tr;

/// How wide the dock is collapsed, in overlay points.
pub(crate) const COLLAPSED_WIDTH: f32 = 52.0;

/// How wide it is as the control rail.
const EXPANDED_WIDTH: f32 = 208.0;

/// How far the dock sits from the screen's right edge.
const EDGE_MARGIN: f32 = 16.0;

/// Height of one row, and of one preset button.
const ROW_HEIGHT: f32 = theme::HIT_PANEL;

/// Gap between two rows.
const ROW_GAP: f32 = 4.0;

/// Height of one preset button. Shorter than a row: three of them are a group, and a group as tall
/// as the list above it would weigh more than what it is a shortcut to.
const PRESET_HEIGHT: f32 = 28.0;

/// Height of the chevron that changes the dock between its two forms.
const CHEVRON_HEIGHT: f32 = 24.0;

/// Size of the keycap chip on a row.
const KEY_WIDTH: f32 = 28.0;
const KEY_HEIGHT: f32 = 22.0;

/// Diameter of the lamp that says whether a surface is on screen.
const LAMP: f32 = 8.0;

/// Gap between the lamp, the name and the keycap.
const ROW_GUTTER: f32 = 8.0;

/// One thing the dock can turn on and off.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Entry {
    /// A surface, named by the shell's own panel table.
    Panel(Panel),
    /// Not a surface but a way of watching: whether a replay gives its own length away.
    SpoilerFree,
}

impl Entry {
    /// The action this row stands for, which is where its keycap comes from.
    fn action(self) -> Action {
        match self {
            Entry::Panel(panel) => panel.action(),
            Entry::SpoilerFree => Action::ToggleSpoilerFree,
        }
    }

    /// What the row is called when there is room to spell it out.
    fn label(self) -> String {
        match self {
            Entry::Panel(Panel::Matchup) => tr!("observer.panelMatchup", "Matchup"),
            Entry::Panel(Panel::MapControl) => tr!("observer.mapControl", "Map control"),
            Entry::Panel(Panel::Economy) => tr!("observer.panelEconomy", "Economy"),
            Entry::Panel(Panel::Military) => tr!("observer.panelMilitary", "Military"),
            Entry::Panel(Panel::Graphs) => tr!("observer.panelGraphs", "Graphs"),
            Entry::Panel(Panel::Timeline) => tr!("observer.panelTimeline", "Timeline"),
            Entry::Panel(Panel::Production) => tr!("observer.panelProduction", "Production"),
            Entry::Panel(Panel::ControlGroups) => {
                tr!("observer.panelControlGroups", "Control groups")
            }
            Entry::Panel(Panel::Console) => tr!("observer.panelConsole", "Console"),
            Entry::Panel(Panel::Minimap) => tr!("observer.panelMinimap", "Minimap"),
            Entry::Panel(Panel::Transport) => tr!("observer.panelTransport", "Transport"),
            Entry::Panel(Panel::Dock) => tr!("observer.panelDock", "Dock"),
            Entry::SpoilerFree => tr!("observer.spoilerFree", "Spoiler-free"),
        }
    }

    /// Whether this row is on.
    fn is_on(self, prefs: &PanelPrefs) -> bool {
        match self {
            Entry::Panel(panel) => prefs.shown(panel),
            Entry::SpoilerFree => prefs.spoiler_free,
        }
    }
}

/// The rows this game gets, in the shell's own panel order.
///
/// The dock itself is not on the list: a row that hid the surface it sits on could not be clicked
/// again, so the dock is reached by its key alone.
fn entries(mode: Mode, map_control_available: bool) -> Vec<Entry> {
    let mut entries: Vec<Entry> = Panel::ALL
        .into_iter()
        .filter(|panel| *panel != Panel::Dock)
        // The transport plate only exists in a replay, so offering it while observing a live game
        // would be offering a switch with nothing behind it.
        .filter(|panel| *panel != Panel::Transport || mode == Mode::Replay)
        // The map-control bar reports a measurement the game does not keep, so a host with none
        // gets no row: a switch that turns nothing on is worse than no switch.
        .filter(|panel| *panel != Panel::MapControl || map_control_available)
        .map(Entry::Panel)
        .collect();
    if mode == Mode::Replay {
        entries.push(Entry::SpoilerFree);
    }
    entries
}

/// What the watcher asked of the dock this frame.
pub struct DockOutcome {
    /// Where the dock is on screen, for the host's hit testing.
    pub rect: Rect,
    /// A surface to turn on or off.
    pub toggled: Option<Panel>,
    /// Whether the replay's length should be withheld.
    pub spoiler_free: Option<bool>,
    /// A whole set of surfaces to move to at once.
    pub preset: Option<PanelPreset>,
    /// Whether the dock should spell its rows out.
    pub expanded: Option<bool>,
}

impl DockOutcome {
    /// An outcome with nothing asked of it yet, waiting for its rect.
    fn none() -> DockOutcome {
        DockOutcome {
            rect: Rect::NOTHING,
            toggled: None,
            spoiler_free: None,
            preset: None,
            expanded: None,
        }
    }
}

/// Draws the dock against the right edge of the screen, fading and sliding it in and out. Returns
/// nothing at all once it is gone.
pub fn render_obs_dock(
    prefs: &PanelPrefs,
    hotkeys: &Hotkeys,
    mode: Mode,
    map_control_available: bool,
    ctx: &Context,
) -> Option<DockOutcome> {
    let id = Id::new("sb_obs_dock");
    let area = Area::new(id)
        .anchor(Align2::RIGHT_CENTER, vec2(-EDGE_MARGIN, 0.0))
        .order(Order::Foreground);
    let inner = motion::presence_area(ctx, id.with("presence"), prefs.dock, area, |ui| {
        tiers::tier0_panel(ui, |ui| {
            let width = if prefs.dock_expanded {
                EXPANDED_WIDTH
            } else {
                COLLAPSED_WIDTH
            };
            ui.set_width(tiers::panel_content_width(width));
            draw_dock(ui, prefs, hotkeys, mode, map_control_available)
        })
        .inner
    })?;
    let mut outcome = inner.inner;
    outcome.rect = inner.response.rect;
    Some(outcome)
}

fn draw_dock(
    ui: &mut Ui,
    prefs: &PanelPrefs,
    hotkeys: &Hotkeys,
    mode: Mode,
    map_control_available: bool,
) -> DockOutcome {
    // The rows are stacked by the gaps written here and by nothing else: this is a fixed layout, and
    // egui's own spacing between items would add to every one of them.
    ui.spacing_mut().item_spacing = vec2(0.0, ROW_GAP);
    let mut outcome = DockOutcome::none();
    let content_width = ui.available_width();

    let dock_key = hotkeys
        .chord_for(Panel::Dock.action())
        .map(|chord| chord.key.symbol_or_name());
    if draw_header(ui, content_width, prefs.dock_expanded, dock_key) {
        outcome.expanded = Some(!prefs.dock_expanded);
    }
    for entry in entries(mode, map_control_available) {
        let key = hotkeys
            .chord_for(entry.action())
            .map(|chord| chord.key.symbol_or_name());
        if !draw_row(ui, content_width, prefs.dock_expanded, entry, key, prefs) {
            continue;
        }
        match entry {
            Entry::Panel(panel) => outcome.toggled = Some(panel),
            Entry::SpoilerFree => outcome.spoiler_free = Some(!prefs.spoiler_free),
        }
    }
    ui.add_space(theme::SPACE_XS);
    widgets::divider(ui);
    ui.add_space(theme::SPACE_XS);
    outcome.preset = draw_presets(ui, content_width, prefs, prefs.dock_expanded);
    outcome
}

/// Draws the dock's own row: what it is, the key that hides it, and the chevron that changes it
/// between its two forms. Clicking anywhere along the row is what makes that change.
///
/// Expanded there is room to name the dock and the key that takes it off screen, which is the one
/// thing a watcher cannot work out from the dock once it is gone. Collapsed, the chevron is all that
/// fits.
fn draw_header(ui: &mut Ui, width: f32, expanded: bool, key: Option<&str>) -> bool {
    let (rect, response) = ui.allocate_exact_size(vec2(width, CHEVRON_HEIGHT), Sense::click());
    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    widgets::state_overlay(ui, &response, rect, corner_radius);
    let color = if response.hovered() {
        theme::TEXT_PRIMARY
    } else {
        theme::TEXT_DIM
    };
    let arm = 4.0;
    let mut centre = rect.center();
    if expanded {
        centre.x = rect.right() - arm - theme::HAIRLINE;
        let key_rect = Rect::from_min_size(
            pos2(
                centre.x - arm - theme::SPACE_XS - KEY_WIDTH,
                rect.center().y - KEY_HEIGHT * 0.5,
            ),
            vec2(KEY_WIDTH, KEY_HEIGHT),
        );
        paint_key_chip(ui, key_rect, key, false);
        paint_text(
            ui,
            Rect::from_min_max(
                rect.left_top(),
                pos2(key_rect.left() - ROW_GUTTER, rect.bottom()),
            ),
            &text::panel_title(),
            &Entry::Panel(Panel::Dock).label(),
            Align::LEFT,
        );
    }
    // Points at the edge the dock would move towards, so the control says what it does without a
    // word: left to open the rail out over the game, right to fold it back against the edge.
    let tip_x = if expanded {
        centre.x + arm
    } else {
        centre.x - arm
    };
    let back_x = if expanded {
        centre.x - arm
    } else {
        centre.x + arm
    };
    let stroke = Stroke::new(theme::HAIRLINE + 0.4, color);
    ui.painter().add(Shape::line(
        vec![
            pos2(back_x, centre.y - arm),
            pos2(tip_x, centre.y),
            pos2(back_x, centre.y + arm),
        ],
        stroke,
    ));
    response.clicked()
}

/// Draws one row, returning whether it was clicked.
fn draw_row(
    ui: &mut Ui,
    width: f32,
    expanded: bool,
    entry: Entry,
    key: Option<&str>,
    prefs: &PanelPrefs,
) -> bool {
    let (rect, response) = ui.allocate_exact_size(vec2(width, ROW_HEIGHT), Sense::click());
    let on = entry.is_on(prefs);
    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    if on && expanded {
        ui.painter()
            .rect_filled(rect, corner_radius, theme::alpha(theme::ACCENT, 0.10));
    }
    widgets::state_overlay(ui, &response, rect, corner_radius);

    // Collapsed, the keycap is the whole row: there is no room for a name, and a watcher reading a
    // strip of keys is reading the same table the rail spells out.
    if !expanded {
        // Square, and as wide as the dock lets it be: collapsed there is nothing else in the row,
        // so the keycap is the row.
        paint_key_chip(ui, centred(rect, rect.width().min(rect.height())), key, on);
        return response.clicked();
    }

    let lamp = Rect::from_min_size(
        pos2(rect.left(), rect.center().y - LAMP * 0.5),
        vec2(LAMP, LAMP),
    );
    paint_lamp(ui, lamp, on);
    let key_rect = Rect::from_min_size(
        pos2(rect.right() - KEY_WIDTH, rect.center().y - KEY_HEIGHT * 0.5),
        vec2(KEY_WIDTH, KEY_HEIGHT),
    );
    paint_key_chip(ui, key_rect, key, on);
    let label = Rect::from_min_max(
        pos2(lamp.right() + ROW_GUTTER, rect.top()),
        pos2(key_rect.left() - ROW_GUTTER, rect.bottom()),
    );
    let color = if on {
        theme::TEXT_PRIMARY
    } else {
        theme::TEXT_DIM
    };
    paint_text(
        ui,
        label,
        &text::body(13.0, BodyWeight::Medium).with_color(color),
        &entry.label(),
        Align::LEFT,
    );
    response.clicked()
}

/// Draws the lamp that says whether a surface is on screen: filled when it is, an empty ring when it
/// is not, so the two states differ in shape as well as in brightness.
fn paint_lamp(ui: &Ui, rect: Rect, on: bool) {
    let centre = rect.center();
    let radius = rect.width() * 0.5;
    if on {
        ui.painter().circle_filled(centre, radius, theme::ACCENT);
    } else {
        ui.painter().circle_stroke(
            centre,
            radius - theme::HAIRLINE * 0.5,
            Stroke::new(theme::HAIRLINE, theme::TEXT_LABEL),
        );
    }
}

/// Draws the keycap chip for a row, lit while the surface it opens is on screen.
fn paint_key_chip(ui: &Ui, rect: Rect, key: Option<&str>, on: bool) {
    let Some(key) = key else {
        return;
    };
    let corner_radius = theme::radius(theme::RADIUS_CHIP);
    // A lit keycap is filled in the overlay's own blue rather than tinted: the dock is read at a
    // glance from the edge of the screen, and a tint is not a state anyone reads from there.
    let (fill, edge, color) = if on {
        (
            theme::alpha(crate::colors::BLUE60, 0.40),
            theme::alpha(crate::colors::BLUE80, 0.45),
            theme::TEXT_PRIMARY,
        )
    } else {
        (
            theme::alpha(crate::colors::GREY_BLUE10, 0.60),
            theme::CHIP_STROKE,
            theme::TEXT_DIM,
        )
    };
    ui.painter().rect_filled(rect, corner_radius, fill);
    ui.painter().add(Shape::rect_stroke(
        rect,
        corner_radius,
        Stroke::new(theme::HAIRLINE, edge),
        StrokeKind::Inside,
    ));
    paint_text(
        ui,
        rect,
        &text::body(11.0, BodyWeight::Medium).with_color(color),
        key,
        Align::Center,
    );
}

/// Draws the presets, stacked: three names beside each other would be three abbreviations in any
/// language that writes them longer than English does, and a preset a watcher cannot read is a
/// preset they will not press.
fn draw_presets(
    ui: &mut Ui,
    width: f32,
    prefs: &PanelPrefs,
    expanded: bool,
) -> Option<PanelPreset> {
    let active = prefs.preset();
    let mut picked = None;
    for preset in PanelPreset::ALL {
        let (rect, _) = ui.allocate_exact_size(vec2(width, PRESET_HEIGHT), Sense::hover());
        let name = preset_label(preset);
        // Collapsed there is room for one character, so it is the initial of the preset's own name:
        // a translated dock abbreviates the word its reader sees spelled out in the rail rather than
        // an English one they never do.
        let label: String = if expanded {
            name
        } else {
            name.chars().next().into_iter().collect()
        };
        if draw_preset(ui, rect, preset, &label, active == Some(preset)) {
            picked = Some(preset);
        }
    }
    picked
}

/// Draws one preset button, returning whether it was clicked.
///
/// Presets carry a hero panel's chrome rather than a keycap's: collapsed, the dock is a column of
/// single characters, and a preset that looked like the keys above it would read as one more key.
fn draw_preset(ui: &mut Ui, rect: Rect, preset: PanelPreset, label: &str, active: bool) -> bool {
    let response = ui.interact(
        rect,
        ui.id().with(("obs_dock_preset", preset.label())),
        Sense::click(),
    );
    let corner_radius = theme::radius(theme::RADIUS_PANEL);
    ui.painter().add(gradient_round_rect(
        rect,
        corner_radius,
        [theme::TIER1_FILL_TOP, theme::TIER1_FILL_BOTTOM],
    ));
    if active {
        ui.painter()
            .rect_filled(rect, corner_radius, theme::alpha(theme::ACCENT, 0.16));
    }
    ui.painter().add(Shape::rect_stroke(
        rect,
        corner_radius,
        Stroke::new(
            theme::HAIRLINE,
            if active {
                theme::ACCENT
            } else {
                theme::TIER1_STROKE
            },
        ),
        StrokeKind::Inside,
    ));
    widgets::state_overlay(ui, &response, rect, corner_radius);
    paint_text(
        ui,
        rect.shrink(theme::SPACE_XS),
        &text::button_label(12.0).with_color(if active {
            theme::ACCENT
        } else {
            theme::TEXT_DIM
        }),
        label,
        Align::Center,
    );
    response.clicked()
}

/// What a preset is called.
fn preset_label(preset: PanelPreset) -> String {
    match preset {
        PanelPreset::Minimal => tr!("observer.presetMinimal", "Minimal"),
        PanelPreset::Standard => tr!("observer.presetStandard", "Standard"),
        PanelPreset::Analyst => tr!("observer.presetAnalyst", "Analyst"),
    }
}
