//! The Network page: the rollback balance and the turn rate 24 delay.

use egui::Ui;

use crate::options::fields::{group_header, hint, slider_row, switch_row};
use crate::options::{
    OptionsLists, OptionsOutcome, OptionsView, RECOMMENDED_ROLLBACK_TARGET, ROLLBACK_TARGET,
    SettingChange,
};
use crate::tr;

pub(super) fn draw(
    ui: &mut Ui,
    view: &OptionsView,
    lists: &OptionsLists,
    outcome: &mut OptionsOutcome,
) {
    group_header(ui, &tr!("options.groupNetwork", "Network"), false);
    if lists.rollback_game {
        slider_row(
            ui,
            &tr!("options.rollbackTarget", "Rollback balance"),
            view.rollback_target,
            ROLLBACK_TARGET,
            false,
            outcome,
            SettingChange::RollbackTarget,
        );
        hint(
            ui,
            &tr!(
                "options.rollbackTargetScale",
                "Smoother \u{2190} \u{2192} more responsive"
            ),
        );
        hint(
            ui,
            &tr!(
                "options.rollbackTargetDescription",
                "Higher values make your commands more responsive, but units may visibly jump \
                 more often. {{value}} is recommended.",
                value = RECOMMENDED_ROLLBACK_TARGET,
            ),
        );
    }
    switch_row(
        ui,
        &tr!("options.turnRate24Delay", "Add TR24 Low input delay"),
        view.turn_rate_24_delay_on,
        false,
        outcome,
        SettingChange::TurnRate24DelayOn,
    );
    hint(
        ui,
        &tr!(
            "options.turnRate24DelayTooltip",
            "Your commands always take at least 2 frames to happen, even when your connection is \
             fast enough for less. This only changes your own game."
        ),
    );
    // How many turns the game keeps in flight is fixed when its turn pipeline is built, before the
    // first frame, and kept for the rest of the game.
    hint(
        ui,
        &tr!("options.turnRate24DelayHint", "Takes effect next game"),
    );
}
