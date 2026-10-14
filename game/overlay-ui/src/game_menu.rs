//! The in-game menu, which stands in for SC:R's own.
//!
//! It is the one screen the player reaches for on purpose while playing, so it is the one screen
//! that says where they are: the wordmark and the game's own clock over a short stack of the things
//! that can be done from here, in the order they are likely to be wanted. Everything here is a pure
//! fn of plain data plus an [`egui::Context`], so the same code renders in the injected game DLL and
//! in the host preview.

use egui::{Align, Context, Id, Layout, Ui, Vec2, vec2};

use crate::kit::text::{self, BodyWeight};
use crate::kit::widgets::{self, ButtonPlate, HoldState};
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

/// One of SC:R's own dialogs for a player's alliances and chat, which the menu opens rather than
/// replaces.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SocialDialog {
    /// Who the player is allied with and shares vision with.
    Alliances,
    /// Who the player's chat messages go to.
    Messaging,
}

/// What the player asked the menu for this frame.
#[derive(Default)]
pub struct GameMenuOutcome {
    /// Whether the player asked to go back to the game, which is the same thing `Esc` asks for.
    pub return_to_game: bool,
    /// Whether the player asked for the options screen, which opens over this menu.
    pub open_options: bool,
    /// Which of SC:R's own alliances and messaging dialogs the player asked for, if either.
    pub open_social: Option<SocialDialog>,
    /// Whether the player asked to leave the game.
    pub leave: bool,
}

/// Draws the in-game menu over the game.
///
/// `playing` is whether the client is a player in the game rather than watching it, which decides
/// what leaving costs and whether there are alliances to set.
pub fn render_game_menu(
    ctx: &Context,
    game_seconds: u64,
    playing: bool,
) -> tiers::DialogResponse<GameMenuOutcome> {
    tiers::tier2_dialog(ctx, Id::new("sb_game_menu"), MENU_WIDTH, |ui| {
        tiers::dialog_header(ui, |ui| draw_header(ui, game_seconds));
        let outcome = tiers::dialog_body(ui, |ui| draw_actions(ui, playing));
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
fn draw_actions(ui: &mut Ui, playing: bool) -> GameMenuOutcome {
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
        ..GameMenuOutcome::default()
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
    // Someone watching has no alliances of their own to set, and chat scope is all they could
    // change there, which the chat box already does. The two share a row: they are the two buttons
    // SC:R puts side by side above the minimap, and each opens its own dialog.
    if playing {
        ui.add_space(BUTTON_GAP);
        let half = vec2((width - BUTTON_GAP) / 2.0, BUTTON_HEIGHT);
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = BUTTON_GAP;
            for (dialog, label) in [
                (
                    SocialDialog::Alliances,
                    tr!("gameMenu.alliances", "Alliances"),
                ),
                (
                    SocialDialog::Messaging,
                    tr!("gameMenu.messaging", "Messaging"),
                ),
            ] {
                if widgets::plate_button(ui, &spec, &label, half, ButtonPlate::standard()).clicked()
                {
                    outcome.open_social = Some(dialog);
                }
            }
        });
    }
    ui.add_space(BUTTON_GAP);
    // A player leaving a game loses it, so that takes a hold rather than a click. Leaving a game
    // only being watched costs nothing.
    outcome.leave = if playing {
        widgets::hold_to_confirm(ui, &tr!("gameMenu.holdToLeave", "Hold to leave game"), size)
            == HoldState::Confirmed
    } else {
        widgets::plate_button(
            ui,
            &spec,
            &tr!("gameMenu.leaveGame", "Leave game"),
            size,
            ButtonPlate::destructive(),
        )
        .clicked()
    };
    outcome
}

/// What the player answered when asked whether to leave.
#[derive(Default)]
pub struct LeaveConfirmOutcome {
    /// Whether they chose to stay.
    pub return_to_game: bool,
    /// Whether they chose to leave.
    pub leave: bool,
}

/// How wide the confirmation is: narrower than the menu, since it asks one question.
const CONFIRM_WIDTH: f32 = 360.0;

/// Asks whether to leave the game, for the keys SC:R quits with (`Alt+Q`, `Alt+X` and their `Ctrl`
/// forms), which in ShieldBattery all come to the same thing: the game ends for this client.
///
/// Leaving costs what it costs from the menu, with the same controls: a hold for a player, whose
/// leaving loses the game, and a click for someone watching.
pub fn render_leave_confirm(
    ctx: &Context,
    playing: bool,
    replay: bool,
) -> tiers::DialogResponse<LeaveConfirmOutcome> {
    tiers::tier2_dialog(ctx, Id::new("sb_leave_confirm"), CONFIRM_WIDTH, |ui| {
        let title = match replay {
            true => tr!("gameMenu.leaveReplayTitle", "Leave the replay?"),
            false => tr!("gameMenu.leaveGameTitle", "Leave the game?"),
        };
        tiers::dialog_header(ui, |ui| tiers::dialog_title(ui, &title));
        tiers::dialog_body(ui, |ui| draw_leave_actions(ui, playing))
    })
}

fn draw_leave_actions(ui: &mut Ui, playing: bool) -> LeaveConfirmOutcome {
    let width = ui.available_width();
    let spec = text::button_label(BUTTON_LABEL_SIZE).with_letter_spacing(BUTTON_TRACKING);
    let size = vec2(width, BUTTON_HEIGHT);
    let mut outcome = LeaveConfirmOutcome {
        return_to_game: widgets::plate_button(
            ui,
            &spec,
            &tr!("gameMenu.returnToGame", "Return to game"),
            size,
            ButtonPlate::primary(),
        )
        .clicked(),
        ..LeaveConfirmOutcome::default()
    };
    ui.add_space(BUTTON_GAP);
    outcome.leave = if playing {
        widgets::hold_to_confirm(ui, &tr!("gameMenu.holdToLeave", "Hold to leave game"), size)
            == HoldState::Confirmed
    } else {
        widgets::plate_button(
            ui,
            &spec,
            &tr!("gameMenu.leaveGame", "Leave game"),
            size,
            ButtonPlate::destructive(),
        )
        .clicked()
    };
    outcome
}

/// The footer: the key that closes the menu.
fn draw_footer(ui: &mut Ui) {
    let width = ui.available_width();
    let spec = text::body(11.0, BodyWeight::Regular).with_color(theme::TEXT_LABEL);
    let note = tr!("gameMenu.escHint", "Esc returns to the game");
    widgets::centered_paragraph(ui, &spec, &note, width);
}

/// Seconds as the game's own clock reads them, growing an hours field only once there is one.
pub(crate) fn clock_text(seconds: u64) -> String {
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
