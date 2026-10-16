//! The in-game menu, which stands in for SC:R's own.
//!
//! It is the one screen the player reaches for on purpose while playing, so it is the one screen
//! that says where they are: the wordmark and the game's own clock over a short stack of the things
//! that can be done from here. The stack keeps SC:R's order and its keys, which players' hands
//! already know: Options (`O`) first, leaving (`E`, SC:R's End Mission) below it, and the way back to
//! the game (`Esc`) last. Each button carries the keycap of its key (see [`OPTIONS_KEY`]). Everything
//! here is a pure fn of plain data plus an [`egui::Context`], so the same code renders in the
//! injected game DLL and in the host preview.

use egui::{Align, Context, Id, Layout, Ui, Vec2, vec2};

use crate::kit::text::{self, BodyWeight};
use crate::kit::widgets::{self, ButtonPlate};
use crate::kit::{theme, tiers};
use crate::{tr, tr_plural};

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

/// The keys the menu's buttons answer to, as their keycaps name them. SC:R's own where it has one:
/// `O` for Options and `E` for End Mission, which works the leave button the way the pointer does:
/// it asks first where leaving is asked about (see [`leave_asks_first`]), so `F10`, `E`, `Q` leaves
/// a game as it does in SC:R, and leaves at once in a replay. SC:R puts alliances and
/// chat behind a Social button on `C`; the button that stands in for it here takes `A` (and `C`, for
/// that habit).
pub const OPTIONS_KEY: &str = "O";
pub const ALLIANCES_KEY: &str = "A";
pub const OBJECTIVES_KEY: &str = "M";
/// SC:R gives pausing no key of its own; `P` is the one a player reaches for.
pub const PAUSE_KEY: &str = "P";
pub const LEAVE_KEY: &str = "E";
pub const RETURN_KEY: &str = "Esc";

/// The keys the leave question takes as its answer: SC:R's own quit dialogs leave on `Q` from a
/// game (Quit Mission) and on `E` from a replay (Exit Replay); either answers here, so a hand that
/// knows one doesn't have to learn which this is.
pub const LEAVE_CONFIRM_KEYS: [&str; 2] = ["Q", "E"];

/// What the game's own menu offers for pausing, which decides what the menu's pause button does.
///
/// The game keeps the rules: a player has a few pauses a game, and anyone in it can resume. The
/// host reads which of the two the game's own menu is showing, so this menu never offers a pause
/// the game would refuse.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum PauseControl {
    /// The game can be paused, by a player with `left` pauses left, where the host knows how many.
    Pause { left: Option<u8> },
    /// The game is paused, and can be resumed.
    Resume,
}

/// What the player asked the menu for this frame.
#[derive(Default)]
pub struct GameMenuOutcome {
    /// Whether the player asked to go back to the game, which is the same thing `Esc` asks for.
    pub return_to_game: bool,
    /// Whether the player asked for the options screen, which opens over this menu.
    pub open_options: bool,
    /// Whether the player asked for the alliances screen, which opens over this menu.
    pub open_alliances: bool,
    /// Whether the player asked for the map's mission objectives, which the game shows in its own
    /// dialog in place of this menu.
    pub open_objectives: bool,
    /// Whether the player asked to pause the game (`true`) or resume it (`false`).
    pub set_paused: Option<bool>,
    /// Whether the player asked to leave the game: at once in a replay, and by way of the leave
    /// question otherwise (see [`leave_asks_first`]).
    pub leave: bool,
}

/// Draws the in-game menu over the game.
///
/// `playing` is whether the client is a player in the game rather than watching it, which decides
/// whether there are alliances to set. `pause` is what the game offers for pausing, if anything.
pub fn render_game_menu(
    ctx: &Context,
    game_seconds: u64,
    playing: bool,
    pause: Option<PauseControl>,
) -> tiers::DialogResponse<GameMenuOutcome> {
    tiers::tier2_dialog(ctx, Id::new("sb_game_menu"), MENU_WIDTH, |ui| {
        tiers::dialog_header(ui, |ui| draw_header(ui, game_seconds));
        tiers::dialog_body(ui, |ui| draw_actions(ui, playing, pause))
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
        ui.label(clock_galley);
    });
}

/// The stack of things that can be done from here, in SC:R's order: Options first, then alliances
/// and chat, the mission objectives, pausing, then leaving, with the way back to the game at the
/// bottom where SC:R keeps it.
fn draw_actions(ui: &mut Ui, playing: bool, pause: Option<PauseControl>) -> GameMenuOutcome {
    let width = ui.available_width();
    let spec = text::button_label(BUTTON_LABEL_SIZE).with_letter_spacing(BUTTON_TRACKING);
    let size = vec2(width, BUTTON_HEIGHT);
    let mut outcome = GameMenuOutcome::default();
    let options = widgets::plate_button(
        ui,
        &spec,
        &tr!("gameMenu.options", "Options"),
        size,
        ButtonPlate::standard(),
    );
    widgets::paint_button_kbd(ui, options.rect, OPTIONS_KEY);
    outcome.open_options = options.clicked();
    // Someone watching has no alliances of their own to set, and their chat only ever goes to the
    // other watchers.
    if playing {
        ui.add_space(BUTTON_GAP);
        let alliances = widgets::plate_button(
            ui,
            &spec,
            &tr!("gameMenu.alliancesAndChat", "Alliances & chat"),
            size,
            ButtonPlate::standard(),
        );
        widgets::paint_button_kbd(ui, alliances.rect, ALLIANCES_KEY);
        outcome.open_alliances = alliances.clicked();
        // The game has objectives only for the people playing it: a watcher's would be empty.
        ui.add_space(BUTTON_GAP);
        let objectives = widgets::plate_button(
            ui,
            &spec,
            &tr!("gameMenu.missionObjectives", "Mission objectives"),
            size,
            ButtonPlate::standard(),
        );
        widgets::paint_button_kbd(ui, objectives.rect, OBJECTIVES_KEY);
        outcome.open_objectives = objectives.clicked();
    }
    if let Some(pause) = pause {
        ui.add_space(BUTTON_GAP);
        let (label, pausing) = match pause {
            PauseControl::Pause { left: Some(left) } => (
                tr_plural!(
                    "gameMenu.pauseGameLeft",
                    u64::from(left),
                    one = "Pause game ({{count}} left)",
                    other = "Pause game ({{count}} left)"
                ),
                true,
            ),
            PauseControl::Pause { left: None } => (tr!("gameMenu.pauseGame", "Pause game"), true),
            PauseControl::Resume => (tr!("gameMenu.resumeGame", "Resume game"), false),
        };
        let button = widgets::plate_button(ui, &spec, &label, size, ButtonPlate::standard());
        widgets::paint_button_kbd(ui, button.rect, PAUSE_KEY);
        if button.clicked() {
            outcome.set_paused = Some(pausing);
        }
    }
    ui.add_space(BUTTON_GAP);
    outcome.leave = leave_button(ui, LEAVE_KEY);
    ui.add_space(BUTTON_GAP);
    outcome.return_to_game = return_button(ui);
    outcome
}

/// Whether the menu's leave button asks before leaving: in a game with other people in it, which a
/// slip of the hand would walk out on (and lose, for a player), but not in a replay, which is
/// watched alone and costs nothing to leave.
pub fn leave_asks_first(replay: bool) -> bool {
    !replay
}

/// The button that leaves the game, marked with `key`.
fn leave_button(ui: &mut Ui, key: &str) -> bool {
    let spec = text::button_label(BUTTON_LABEL_SIZE).with_letter_spacing(BUTTON_TRACKING);
    let size = vec2(ui.available_width(), BUTTON_HEIGHT);
    let button = widgets::plate_button(
        ui,
        &spec,
        &tr!("gameMenu.leaveGame", "Leave game"),
        size,
        ButtonPlate::destructive(),
    );
    widgets::paint_button_kbd(ui, button.rect, key);
    button.clicked()
}

/// The button back to the game, which is what `Esc` does wherever the menu or its question is up.
fn return_button(ui: &mut Ui) -> bool {
    let spec = text::button_label(BUTTON_LABEL_SIZE).with_letter_spacing(BUTTON_TRACKING);
    let size = vec2(ui.available_width(), BUTTON_HEIGHT);
    let button = widgets::plate_button(
        ui,
        &spec,
        &tr!("gameMenu.returnToGame", "Return to game"),
        size,
        ButtonPlate::primary(),
    );
    widgets::paint_button_kbd(ui, button.rect, RETURN_KEY);
    button.clicked()
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

/// Asks whether to leave the game, for the menu's leave button where it asks first and for the keys
/// SC:R quits with (`Alt+Q`, `Alt+X` and their `Ctrl` forms), which in ShieldBattery all come to the
/// same thing: the game ends for this client.
pub fn render_leave_confirm(
    ctx: &Context,
    replay: bool,
) -> tiers::DialogResponse<LeaveConfirmOutcome> {
    tiers::tier2_dialog(ctx, Id::new("sb_leave_confirm"), CONFIRM_WIDTH, |ui| {
        let title = match replay {
            true => tr!("gameMenu.leaveReplayTitle", "Leave the replay?"),
            false => tr!("gameMenu.leaveGameTitle", "Leave the game?"),
        };
        tiers::dialog_header(ui, |ui| tiers::dialog_title(ui, &title));
        tiers::dialog_body(ui, |ui| draw_leave_actions(ui, replay))
    })
}

/// The question's answers in SC:R's order, leaving above the way back. The leave button shows the
/// key SC:R's own question takes here (`E` in a replay, `Q` otherwise); both answer either way.
fn draw_leave_actions(ui: &mut Ui, replay: bool) -> LeaveConfirmOutcome {
    let key = match replay {
        true => LEAVE_CONFIRM_KEYS[1],
        false => LEAVE_CONFIRM_KEYS[0],
    };
    let leave = leave_button(ui, key);
    ui.add_space(BUTTON_GAP);
    LeaveConfirmOutcome {
        leave,
        return_to_game: return_button(ui),
    }
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
