//! The in-game menu, which stands in for SC:R's own.
//!
//! It is the one screen the player reaches for on purpose while playing, so it is the one screen
//! that says where they are: the wordmark and the game's own clock over a short stack of the things
//! that can be done from here, in the order they are likely to be wanted. Everything here is a pure
//! fn of plain data plus an [`egui::Context`], so the same code renders in the injected game DLL and
//! in the host preview.

use egui::{Align, Context, Id, Layout, Ui, Vec2, vec2};

use crate::kit::text::{self, BodyWeight};
use crate::kit::widgets::{self, ButtonPlate};
use crate::kit::{theme, tiers};
use crate::tr;

/// How wide the menu is, in overlay points.
const MENU_WIDTH: f32 = 400.0;

/// The height of one of the menu's buttons, and the gap between two of them.
const BUTTON_HEIGHT: f32 = 44.0;
const BUTTON_GAP: f32 = 12.0;

/// Size of a button's label, and how far its capitals are tracked apart.
const BUTTON_LABEL_SIZE: f32 = 13.0;
const BUTTON_TRACKING: f32 = 1.8;

/// Size of the wordmark over the menu.
const WORDMARK_SIZE: f32 = 26.0;

/// Size of the clock in the header, which is a reminder rather than something to read off.
const CLOCK_SIZE: f32 = 18.0;

/// The product's name, which is a name and not a phrase: it reads the same in every language the
/// overlay speaks, so it never goes through the translation catalogs.
const WORDMARK: &str = "ShieldBattery";

/// What the player asked the menu for this frame.
///
/// Only the actions the overlay can carry out today are reported. The rest of the stack is drawn
/// so the menu is the menu, and each will report itself here as the host action behind it is built.
#[derive(Default)]
pub struct GameMenuOutcome {
    /// Whether the player asked to go back to the game, which is the same thing `Esc` asks for.
    pub return_to_game: bool,
    /// Whether the player asked for the options screen, which opens over this menu.
    pub open_options: bool,
}

/// Draws the in-game menu over the paused game.
pub fn render_game_menu(
    ctx: &Context,
    game_seconds: u64,
) -> tiers::DialogResponse<GameMenuOutcome> {
    tiers::tier2_dialog(ctx, Id::new("sb_game_menu"), MENU_WIDTH, |ui| {
        tiers::dialog_header(ui, |ui| draw_header(ui, game_seconds));
        let outcome = tiers::dialog_body(ui, draw_actions);
        tiers::dialog_footer(ui, draw_footer);
        outcome
    })
}

/// The header: whose game this is, and how long it has been running.
fn draw_header(ui: &mut Ui, game_seconds: u64) {
    ui.vertical_centered(|ui| {
        ui.label(
            text::player_name(WORDMARK_SIZE)
                .with_letter_spacing(0.5)
                .job(WORDMARK),
        );
        ui.add_space(theme::SPACE_SM + 2.0);
        draw_clock(ui, game_seconds);
    });
}

/// How long the game has been running, as a label and a clock centred together rather than each on
/// its own.
fn draw_clock(ui: &mut Ui, game_seconds: u64) {
    let label_spec = text::body(13.0, BodyWeight::Regular).with_color(theme::TEXT_DIM);
    let label = tr!("gameMenu.gameTime", "Game time");
    let label_galley = label_spec.galley(ui, &label);
    let clock_spec = text::numeral(CLOCK_SIZE);
    let clock_galley = clock_spec.galley(ui, &clock_text(game_seconds));
    let gap = theme::SPACE_SM + 2.0;
    let size = vec2(
        label_galley.size().x + gap + clock_galley.size().x,
        label_galley.size().y.max(clock_galley.size().y),
    );
    ui.allocate_ui_with_layout(size, Layout::left_to_right(Align::Center), |ui| {
        ui.spacing_mut().item_spacing = Vec2::ZERO;
        ui.label(label_spec.job(&label));
        ui.add_space(gap);
        ui.label(clock_spec.job(&clock_text(game_seconds)));
    });
}

/// The stack of things that can be done from here, loudest first.
fn draw_actions(ui: &mut Ui) -> GameMenuOutcome {
    let width = ui.available_width();
    let spec = text::button_label(BUTTON_LABEL_SIZE).with_letter_spacing(BUTTON_TRACKING);
    let size = vec2(width, BUTTON_HEIGHT);
    let mut outcome = GameMenuOutcome {
        return_to_game: widgets::plate_button(
            ui,
            &spec,
            &tr!("gameMenu.returnToGame", "Return to game"),
            size,
            ButtonPlate::primary(),
        )
        .clicked(),
        open_options: false,
    };
    ui.add_space(BUTTON_GAP);
    outcome.open_options = widgets::plate_button(
        ui,
        &spec,
        &tr!("gameMenu.options", "Options"),
        size,
        ButtonPlate::standard(),
    )
    .clicked();
    // The rest of the stack has no host action behind it yet: the screen one of them opens has
    // not been built, and leaving a game is a command the overlay does not send. They are drawn
    // because a menu missing half its entries is not the menu it replaces.
    for (label, plate) in [
        (
            tr!("gameMenu.alliancesAndChat", "Alliances & chat"),
            ButtonPlate::standard(),
        ),
        // Multiplayer has no surrender; the label is a catalog entry rather than a literal so the
        // word can follow whatever the game ends up offering.
        (tr!("gameMenu.surrender", "Surrender"), ButtonPlate::quiet()),
        (
            tr!("gameMenu.leaveGame", "Leave game"),
            ButtonPlate::destructive(),
        ),
    ] {
        ui.add_space(BUTTON_GAP);
        widgets::plate_button(ui, &spec, &label, size, plate);
    }
    outcome
}

/// The footer: the key that closes the menu, and the reason closing it is not urgent.
fn draw_footer(ui: &mut Ui) {
    let width = ui.available_width();
    let note = format!(
        "{} \u{b7} {}",
        tr!("gameMenu.escHint", "Esc returns to the game"),
        tr!(
            "gameMenu.keepsRunning",
            "Game keeps running while this menu is open"
        )
    );
    let spec = text::body(11.0, BodyWeight::Regular).with_color(theme::TEXT_LABEL);
    widgets::centered_paragraph(ui, &spec, &note, width);
}

/// Seconds as the game's own clock reads them, growing an hours field only once there is one.
fn clock_text(seconds: u64) -> String {
    let minutes = seconds / 60;
    let seconds = seconds % 60;
    if minutes >= 60 {
        format!("{}:{:02}:{seconds:02}", minutes / 60, minutes % 60)
    } else {
        format!("{minutes}:{seconds:02}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_clock_grows_an_hours_field_only_once_there_is_one() {
        assert_eq!(clock_text(0), "0:00");
        assert_eq!(clock_text(1068), "17:48");
        assert_eq!(clock_text(3930), "1:05:30");
    }
}
