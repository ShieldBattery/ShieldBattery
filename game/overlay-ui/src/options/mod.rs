//! The in-game options screen's presentation layer: a plain-data view-model and the egui render fn
//! that draws it. Like [`crate::chat_history`] and [`crate::game_menu`], everything here is a pure
//! fn of [`OptionsView`] plus an [`egui::Context`], so the same code renders in the injected game
//! DLL and in the host preview.
//!
//! It stands in for the game's own options popup, so it is drawn at the kit's modal tier. It is
//! organized the way the app's game settings are — input, sound, video, gameplay, in that order,
//! with the same groups and the same words inside each — because the two screens are one setting
//! list seen from two places, and a player who learned where a setting lives in the app must not
//! have to learn it again here. The network settings the app keeps with its system settings follow
//! them, as a section of their own.
//!
//! What it does not carry: the color schemes the app resolves into player colors before a game
//! starts (only which of the game's color modes is in use), the window placement a windowed game is
//! launched with, and the settings that exist only in a dev client.
//!
//! Nothing here writes a setting. A row reports a [`SettingChange`] carrying the value the player
//! moved it to, and the host applies it: the view-model is what the game currently holds, not a
//! place to stage edits in.
//!
//! This module draws the screen's chrome: header, section nav, scrolling body and footer. The
//! settings model is in `model`, each section's rows in `pages`, and the row shapes they are built
//! from in `fields`.

mod fields;
mod model;
mod pages;

pub use model::{
    ANNOUNCERS, APM_ALERT_VALUE, BRIGHTNESS, CONSOLE_SKINS, CURSOR_SIZE_EIGHTHS, DisplayMode,
    FPS_LIMIT, FramePacing, GRAB_PAN_SENSITIVITY, MOUSE_SENSITIVITY, MinimapColorMode,
    MinimapPosition, MinimapTerrain, MonitorView, NamedChoice, OptionsLists, OptionsView,
    RECOMMENDED_ROLLBACK_TARGET, ROLLBACK_TARGET, SCROLL_SPEED, SD_GRAPHICS_FILTER, SettingChange,
    SliderRange, StartingFog, UNIT_SKINS, UnitPortraits, VOLUME,
};

use egui::{Align, Context, Id, Key, Layout, Sense, Shape, Stroke, Ui, Vec2, pos2, vec2};
use serde::{Deserialize, Serialize};

use crate::colors::GREY_BLUE70;
use crate::kit::text::{self, BodyWeight};
use crate::kit::widgets::{self, ButtonPlate};
use crate::kit::{theme, tiers};
use crate::tr;

/// How wide the dialog is, chrome included.
pub const DIALOG_WIDTH: f32 = 940.0;

/// Width of the section nav down the left of the body.
const NAV_WIDTH: f32 = 220.0;

/// Height of one nav row.
const NAV_ROW_HEIGHT: f32 = 42.0;

/// How far a nav row's label stands in from the row's left edge, lit or not.
const NAV_LABEL_INSET: f32 = theme::SPACE_LG;

/// Padding between the nav column's edges and its rows.
const NAV_PAD_X: f32 = 14.0;
const NAV_PAD_Y: f32 = 16.0;

/// Padding between the content column's edge and its rows. Inside the scrolling region, along
/// with the nav's, so the body meets the rules above and below it and a row is cut exactly there.
const CONTENT_PAD_X: f32 = 24.0;
const CONTENT_PAD_Y: f32 = 24.0;

/// The least room the body leaves the content column, and the most it will grow to on a tall
/// screen. A section is taller than either, so what this really decides is how much of one is read
/// without scrolling.
const BODY_MIN_HEIGHT: f32 = 470.0;
const BODY_MAX_HEIGHT: f32 = 700.0;

/// What the dialog's own chrome takes above and below the body, which is what the body is sized
/// against so the whole dialog fits the screen it is centered on.
const CHROME_HEIGHT: f32 = 160.0;

/// How much of the screen the dialog leaves above and below itself. Below 1080 lines the overlay
/// stops scaling down and a point is a pixel, so a screen shorter than the design's is a screen
/// with fewer points on it: the body gives room back rather than the chrome running off the edge.
const SCREEN_MARGIN: f32 = 40.0;

/// Width the vertical scrollbar and its margins take out of the content column. Reserved whether or
/// not the section is long enough to scroll, so the rows of a short section line up with a long
/// one's.
const SCROLLBAR_WIDTH: f32 = theme::SCROLLBAR_WIDTH + theme::SCROLLBAR_INSET + theme::SPACE_XS;

/// How much room the content column leaves its rows. The scrollbar's own margins are the padding
/// on the right, the way the chat log's list is padded.
const CONTENT_WIDTH: f32 =
    DIALOG_WIDTH - NAV_WIDTH - theme::HAIRLINE - CONTENT_PAD_X * 2.0 - SCROLLBAR_WIDTH;

/// Text size of the dialog's subtitle.
const SUBTITLE_SIZE: f32 = 13.0;

/// Which page of the options is on screen.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub enum OptionsSection {
    Input,
    Sound,
    Video,
    /// Where the screen opens: the settings a player changes mid-match are here.
    #[default]
    Gameplay,
    Network,
}

impl OptionsSection {
    /// Every section, in the order the app's own settings list them.
    pub const ALL: [OptionsSection; 5] = [
        OptionsSection::Input,
        OptionsSection::Sound,
        OptionsSection::Video,
        OptionsSection::Gameplay,
        OptionsSection::Network,
    ];

    /// What the nav calls this section.
    pub fn label(self) -> String {
        match self {
            OptionsSection::Input => tr!("options.sectionInput", "Input"),
            OptionsSection::Sound => tr!("options.sectionSound", "Sound"),
            OptionsSection::Video => tr!("options.sectionVideo", "Video"),
            OptionsSection::Gameplay => tr!("options.sectionGameplay", "Gameplay"),
            OptionsSection::Network => tr!("options.sectionNetwork", "Network"),
        }
    }

    /// The key that turns the screen to this section, which its nav row carries as a keycap. SC:R's
    /// own options screen puts its pages on their initials, and these are its keys for the pages
    /// that have one here; Gameplay is its Game page.
    pub fn key(self) -> Key {
        match self {
            OptionsSection::Input => Key::I,
            OptionsSection::Sound => Key::S,
            OptionsSection::Video => Key::V,
            OptionsSection::Gameplay => Key::G,
            OptionsSection::Network => Key::N,
        }
    }

    /// A short name for this section in a knob panel or a log line.
    pub fn slug(self) -> &'static str {
        match self {
            OptionsSection::Input => "input",
            OptionsSection::Sound => "sound",
            OptionsSection::Video => "video",
            OptionsSection::Gameplay => "gameplay",
            OptionsSection::Network => "network",
        }
    }
}

/// The key the Done button answers to, as its keycap names it: SC:R's options screen goes back on
/// `Esc`, which closes every screen of ours too.
pub const DONE_KEY: &str = "Esc";

/// What the player did with the options screen this frame.
#[derive(Default)]
pub struct OptionsOutcome {
    /// The section they moved the nav to.
    pub section: Option<OptionsSection>,
    /// Every setting they moved, in the order they moved it.
    pub changes: Vec<SettingChange>,
    /// Whether they asked for the screen to close.
    pub done: bool,
}

/// Renders the options screen.
pub fn render_options_view(
    view: &OptionsView,
    lists: &OptionsLists,
    ctx: &Context,
    section: OptionsSection,
) -> tiers::DialogResponse<OptionsOutcome> {
    let body_height = (ctx.viewport_rect().height() - CHROME_HEIGHT - SCREEN_MARGIN * 2.0)
        .clamp(BODY_MIN_HEIGHT, BODY_MAX_HEIGHT);
    tiers::tier2_dialog(ctx, Id::new("sb_options"), DIALOG_WIDTH, |ui| {
        let mut outcome = OptionsOutcome::default();
        tiers::dialog_header(ui, draw_header);
        tiers::dialog_body_flush(ui, |ui| {
            ui.horizontal_top(|ui| {
                ui.spacing_mut().item_spacing = Vec2::ZERO;
                outcome.section = draw_nav(ui, section, body_height);
                draw_nav_rule(ui, body_height);
                draw_content(ui, view, lists, section, body_height, &mut outcome);
            });
        });
        tiers::dialog_footer_ruled(ui, |ui| draw_footer(ui, &mut outcome));
        outcome
    })
}

/// The header: what the screen is, and what changing something on it does.
fn draw_header(ui: &mut Ui) {
    let width = ui.available_width();
    ui.horizontal(|ui| {
        ui.set_width(width);
        tiers::dialog_title(ui, &tr!("options.title", "Options"));
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            // Whatever the title left: a subtitle long enough to reach it would otherwise be drawn
            // over the one word the header exists to say.
            let room = (ui.available_width() - theme::SPACE_XL).max(0.0);
            ui.label(
                text::body(SUBTITLE_SIZE, BodyWeight::Regular)
                    .with_color(GREY_BLUE70)
                    .job_truncated(
                        &tr!(
                            "options.subtitle",
                            "Changes apply immediately and are saved with your ShieldBattery settings"
                        ),
                        room,
                    ),
            );
        });
    });
}

/// The section nav. Returns the section the player moved to, on the frame they moved it.
fn draw_nav(ui: &mut Ui, section: OptionsSection, height: f32) -> Option<OptionsSection> {
    let mut picked = None;
    ui.allocate_ui_with_layout(
        vec2(NAV_WIDTH, height),
        Layout::top_down(Align::LEFT),
        |ui| {
            ui.set_width(NAV_WIDTH);
            ui.set_min_height(height);
            ui.spacing_mut().item_spacing = Vec2::ZERO;
            ui.add_space(NAV_PAD_Y);
            ui.horizontal_top(|ui| {
                ui.add_space(NAV_PAD_X);
                ui.vertical(|ui| {
                    for entry in OptionsSection::ALL {
                        if draw_nav_row(ui, entry, entry == section) {
                            picked = Some(entry);
                        }
                    }
                });
            });
        },
    );
    picked
}

/// One nav row: a plain label, or the lit plate that says the player is reading this section.
fn draw_nav_row(ui: &mut Ui, section: OptionsSection, active: bool) -> bool {
    let size = vec2(NAV_WIDTH - NAV_PAD_X * 2.0, NAV_ROW_HEIGHT);
    let key = section.key().name();
    // The lit row keeps its label where the plain rows keep theirs: a label that slid to the
    // middle of the plate as it lit would read as the nav rearranging itself with every click.
    let (response, spec) = if active {
        let plate = ButtonPlate::selected();
        let spec = text::button_label(14.0)
            .with_letter_spacing(1.0)
            .with_color(plate.label);
        // The plate's own label is left empty and set below with the plain rows', so lit or not a
        // label gives way to the keycap at the same point.
        let response =
            widgets::plate_button_aligned(ui, &spec, "", size, plate, Align::LEFT, NAV_LABEL_INSET);
        (response, spec)
    } else {
        let (rect, response) = ui.allocate_exact_size(size, Sense::click());
        if ui.is_rect_visible(rect) {
            widgets::state_overlay(ui, &response, rect, theme::radius(theme::RADIUS_TIGHT));
        }
        let spec = text::body(15.0, BodyWeight::Regular).with_color(theme::TEXT_SECONDARY);
        (response, spec)
    };
    let rect = response.rect;
    if ui.is_rect_visible(rect) {
        // The keycap stands at the row's right end, so a long label gives way to it rather than
        // running under it.
        let key_room = widgets::kbd_size(ui, key).x + theme::SPACE_SM;
        let job = spec.job_truncated(&section.label(), size.x - NAV_LABEL_INSET * 2.0 - key_room);
        let galley = ui.ctx().fonts_mut(|fonts| fonts.layout_job(job));
        ui.painter().galley(
            pos2(
                rect.left() + NAV_LABEL_INSET,
                rect.center().y - galley.size().y * 0.5,
            ),
            galley,
            spec.color,
        );
        widgets::paint_button_kbd(ui, rect, key);
    }
    ui.add_space(theme::SPACE_XS);
    response.clicked()
}

/// The rule that separates the nav from what it selects.
fn draw_nav_rule(ui: &mut Ui, height: f32) {
    let (rect, _) = ui.allocate_exact_size(vec2(theme::HAIRLINE, height), Sense::hover());
    ui.painter().add(Shape::line_segment(
        [
            pos2(rect.center().x, rect.top()),
            pos2(rect.center().x, rect.bottom()),
        ],
        Stroke::new(theme::HAIRLINE, theme::TIER2_DIVIDER),
    ));
}

/// The selected section's rows, scrolling when there are more of them than the body has room for.
fn draw_content(
    ui: &mut Ui,
    view: &OptionsView,
    lists: &OptionsLists,
    section: OptionsSection,
    height: f32,
    outcome: &mut OptionsOutcome,
) {
    let width = ui.available_width();
    ui.allocate_ui_with_layout(vec2(width, height), Layout::top_down(Align::LEFT), |ui| {
        ui.set_width(width);
        ui.set_min_height(height);
        egui::ScrollArea::vertical()
            // Per section, so each one remembers where its reader left it rather than every
            // section sharing one scroll position.
            .id_salt(("sb_options_section", section.slug()))
            .max_height(height)
            .auto_shrink([false, false])
            .show(ui, |ui| {
                ui.add_space(CONTENT_PAD_Y);
                ui.horizontal_top(|ui| {
                    ui.add_space(CONTENT_PAD_X);
                    ui.allocate_ui_with_layout(
                        vec2(CONTENT_WIDTH, 0.0),
                        Layout::top_down(Align::LEFT),
                        |ui| {
                            ui.set_width(CONTENT_WIDTH);
                            ui.spacing_mut().item_spacing = Vec2::ZERO;
                            pages::draw(ui, section, view, lists, outcome);
                        },
                    );
                });
                ui.add_space(CONTENT_PAD_Y);
            });
    });
}

/// The footer: the Done button that closes the screen.
fn draw_footer(ui: &mut Ui, outcome: &mut OptionsOutcome) {
    let width = ui.available_width();
    ui.allocate_ui_with_layout(
        vec2(width, theme::HIT_DIALOG),
        Layout::right_to_left(Align::Center),
        |ui| {
            ui.set_width(width);
            let done = widgets::button_with_kbd(
                ui,
                &tr!("common.done", "Done"),
                widgets::ButtonVariant::Tier2,
                DONE_KEY,
            );
            widgets::default_focus(&done);
            outcome.done = done.clicked();
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The nav reads in the order the app's own settings do, and opens where a player mid-match
    /// wants to be.
    #[test]
    fn the_sections_are_in_the_apps_order() {
        assert_eq!(
            OptionsSection::ALL,
            [
                OptionsSection::Input,
                OptionsSection::Sound,
                OptionsSection::Video,
                OptionsSection::Gameplay,
                OptionsSection::Network,
            ]
        );
        assert_eq!(OptionsSection::default(), OptionsSection::Gameplay);
    }
}
