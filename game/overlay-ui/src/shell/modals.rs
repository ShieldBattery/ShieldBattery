//! The modal layer: which surfaces can be modal, what each one may do (its [`ModalPolicy`]), the
//! stack of those on screen, and how the one on top is drawn.

use egui::Context;

use super::native_dialogs::NativeDialog;
use super::{HitRect, HostFrame, Mode, Views};
use crate::alliances::{AlliancesAction, AlliancesDraft, AlliancesMenu, render_alliances_view};
use crate::chat_history::{ChatHistoryView, render_chat_history_view};
use crate::disconnect::render_disconnect_view;
use crate::end_card::{EndCardChoice, EndCardView, GameResult, StatRanks, render_end_card};
use crate::game_menu::{leave_asks_first, render_game_menu, render_leave_confirm};
use crate::options::{
    OptionsLists, OptionsOutcome, OptionsSection, OptionsView, SettingChange, render_options_view,
};

/// Which modal surface is on the stack.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ModalId {
    /// The simulation is blocked on at least one peer, with a manual drop once the gate passes.
    WaitingForPlayers,
    /// This client's own link to the relay is down.
    ConnectionInterrupted,
    /// This client's session is over for good: disconnected beyond recovery, or desynced.
    SessionEnded,
    /// The in-game menu, standing in for SC:R's own.
    GameMenu,
    /// The chat log, standing in for SC:R's own.
    ChatHistory,
    /// The settings screen, standing in for SC:R's own options popup.
    Options,
    /// The end-of-game card for a player who has won, standing in for SC:R's victory popup.
    Victory,
    /// The end-of-game card for a player who has lost, standing in for SC:R's defeat popup.
    Defeat,
    /// The question SC:R's quit keys ask, standing in for its quit dialogs.
    LeaveGame,
    /// Alliances, shared vision, and whose chat a player hears and who theirs goes to, standing in
    /// for SC:R's alliance and chat recipient dialogs.
    Alliances,
}

/// What a modal may do, and what stands behind it. Each modal's is written out in
/// [`ModalId::policy`], so every capability of a new modal is decided in one place.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ModalPolicy {
    /// Whether the game's own state raises and lowers this modal rather than the player: it is up
    /// exactly while its condition holds.
    pub status_driven: bool,
    /// Whether the player can close this modal themselves, with `Esc` or a click on the scrim. Never
    /// a status-driven one, which closing would only make reappear on the next frame.
    pub dismissible: bool,
    /// Whether the player can open BW's chat box while this modal takes their input. A modal that
    /// stands in for a dialog of SC:R's takes every input while it is up, the chat box's included,
    /// as that dialog does: a box left open under one waits until it is gone.
    pub allows_chat: bool,
    /// Whether this modal's buttons answer to keys (see [`Shell::key_pressed`](super::Shell::key_pressed)),
    /// which is when a host hands the shell every keypress first: the keys type nothing here, and a
    /// control holding the keyboard would otherwise take a key that is meant for one of the buttons.
    pub buttons_answer_to_keys: bool,
    /// The native dialogs this modal stands in for, which the host must dismiss along with it, and
    /// whose spawn raises it.
    pub native_dialogs: &'static [NativeDialog],
    /// The result an end-of-game card reports, for the modals that are one.
    pub game_result: Option<GameResult>,
    /// A short name for this modal in a knob panel or a log line.
    pub label: &'static str,
}

impl ModalId {
    /// Every modal, which is where a spawning native dialog's replacement is looked up.
    pub const ALL: [ModalId; 10] = [
        ModalId::WaitingForPlayers,
        ModalId::ConnectionInterrupted,
        ModalId::SessionEnded,
        ModalId::GameMenu,
        ModalId::ChatHistory,
        ModalId::Options,
        ModalId::Victory,
        ModalId::Defeat,
        ModalId::LeaveGame,
        ModalId::Alliances,
    ];

    /// What this modal may do.
    pub fn policy(self) -> ModalPolicy {
        match self {
            ModalId::WaitingForPlayers => ModalPolicy {
                status_driven: true,
                dismissible: false,
                // The players kept waiting are the ones with something to say to each other, and
                // SC:R lets them chat through the wait too.
                allows_chat: true,
                // A roster's drop controls are one per player, so no one key could stand for them.
                buttons_answer_to_keys: false,
                native_dialogs: &[],
                game_result: None,
                label: "waiting for players",
            },
            ModalId::ConnectionInterrupted => ModalPolicy {
                status_driven: true,
                dismissible: false,
                allows_chat: false,
                buttons_answer_to_keys: true,
                native_dialogs: &[],
                game_result: None,
                label: "connection interrupted",
            },
            ModalId::SessionEnded => ModalPolicy {
                status_driven: true,
                dismissible: false,
                allows_chat: false,
                buttons_answer_to_keys: true,
                native_dialogs: &[],
                game_result: None,
                label: "session ended",
            },
            ModalId::GameMenu => ModalPolicy {
                status_driven: false,
                dismissible: true,
                allows_chat: false,
                buttons_answer_to_keys: true,
                native_dialogs: &[NativeDialog::GameMenu],
                game_result: None,
                label: "game menu",
            },
            ModalId::ChatHistory => ModalPolicy {
                status_driven: false,
                dismissible: true,
                allows_chat: false,
                buttons_answer_to_keys: true,
                native_dialogs: &[NativeDialog::ChatHistory],
                game_result: None,
                label: "chat history",
            },
            ModalId::Options => ModalPolicy {
                status_driven: false,
                dismissible: true,
                allows_chat: false,
                buttons_answer_to_keys: true,
                // SC:R's own options are a web popup its menu opens, and the menu that would have
                // opened it is ours already.
                native_dialogs: &[],
                game_result: None,
                label: "options",
            },
            ModalId::Victory => ModalPolicy {
                status_driven: false,
                // Dismissing the card is choosing to keep playing, which the native dialog behind
                // it carries out when the dismissal closes it.
                dismissible: true,
                allows_chat: false,
                buttons_answer_to_keys: true,
                native_dialogs: &[NativeDialog::Victory],
                game_result: Some(GameResult::Victory),
                label: "victory",
            },
            ModalId::Defeat => ModalPolicy {
                status_driven: false,
                // A defeated player can only leave: SC:R's defeat popup stays up until its OK.
                dismissible: false,
                allows_chat: false,
                buttons_answer_to_keys: true,
                native_dialogs: &[NativeDialog::Defeat],
                game_result: Some(GameResult::Defeat),
                label: "defeat",
            },
            ModalId::LeaveGame => ModalPolicy {
                status_driven: false,
                dismissible: true,
                allows_chat: false,
                buttons_answer_to_keys: true,
                // SC:R's quit dialogs are never spawned behind it: the keys that open them are
                // taken before the game sees them.
                native_dialogs: &[],
                game_result: None,
                label: "leave game",
            },
            ModalId::Alliances => ModalPolicy {
                status_driven: false,
                dismissible: true,
                allows_chat: false,
                buttons_answer_to_keys: true,
                // One screen for what SC:R splits across two dialogs: whichever of them the
                // minimap's buttons opened is the one behind it.
                native_dialogs: &[NativeDialog::AllianceFilter, NativeDialog::MessageFilter],
                game_result: None,
                label: "alliances",
            },
        }
    }

    /// See [`ModalPolicy::buttons_answer_to_keys`].
    pub fn buttons_answer_to_keys(self) -> bool {
        self.policy().buttons_answer_to_keys
    }

    /// See [`ModalPolicy::game_result`].
    pub fn game_result(self) -> Option<GameResult> {
        self.policy().game_result
    }

    /// See [`ModalPolicy::label`].
    pub fn label(self) -> &'static str {
        self.policy().label
    }

    /// The result an end-of-game card reports for this modal, from the vantage point the game is
    /// watched from: whatever the game's own popup says, a watcher's game is simply over.
    pub fn end_card_result(self, mode: Mode) -> Option<GameResult> {
        self.game_result().map(|result| match mode.is_spectating() {
            true => GameResult::GameOver,
            false => result,
        })
    }
}

impl NativeDialog {
    /// The modal this dialog's replacement puts on the stack when the dialog spawns: the one whose
    /// policy says it stands in for it.
    ///
    /// `TimeOut` has none: the surface that stands in for it is the disconnect modal, which the
    /// disconnect status raises and lowers on its own schedule. BW spawns its timeout dialog on a
    /// timer of its own, so tying our surface to that spawn would show and hide it at the wrong
    /// moments.
    pub fn replacement_modal(self) -> Option<ModalId> {
        ModalId::ALL
            .into_iter()
            .find(|id| id.policy().native_dialogs.contains(&self))
    }
}

/// One entry on the modal stack.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
struct Modal {
    id: ModalId,
    /// Whether this modal takes every input while it is up. Carried per entry rather than derived
    /// from the id, because the disconnect surface is modal at both of its tiers but only takes
    /// input once the connection problem is real.
    captures_input: bool,
}

/// The modals on screen, bottom first, and which of the native dialogs behind them are still up.
#[derive(Default)]
pub(super) struct ModalStack {
    entries: Vec<Modal>,
    /// Which replaced native dialogs the host has reported as live, indexed by
    /// [`NativeDialog::index`]. A dismissal only asks the host to close a dialog that is still
    /// there.
    live_native_dialogs: [bool; NativeDialog::ALL.len()],
}

impl ModalStack {
    /// The modal stack, bottom first.
    pub(super) fn ids(&self) -> impl Iterator<Item = ModalId> + '_ {
        self.entries.iter().map(|modal| modal.id)
    }

    /// The modal that owns the screen, if any.
    pub(super) fn top(&self) -> Option<ModalId> {
        self.entries.last().map(|modal| modal.id)
    }

    pub(super) fn contains(&self, id: ModalId) -> bool {
        self.entries.iter().any(|modal| modal.id == id)
    }

    /// Puts `id` on top, taking every input, unless it is on the stack already: one modal stacked
    /// twice would leave one of it behind when the other closed.
    pub(super) fn raise(&mut self, id: ModalId) {
        if !self.contains(id) {
            self.entries.push(Modal {
                id,
                captures_input: true,
            });
        }
    }

    pub(super) fn remove(&mut self, id: ModalId) {
        self.entries.retain(|modal| modal.id != id);
    }

    pub(super) fn pop(&mut self) -> Option<ModalId> {
        self.entries.pop().map(|modal| modal.id)
    }

    pub(super) fn native_dialog_live(&self, dialog: NativeDialog) -> bool {
        self.live_native_dialogs[dialog.index()]
    }

    /// Records that the host hid a spawning native dialog, and raises the modal standing in for it.
    pub(super) fn native_dialog_spawned(&mut self, dialog: NativeDialog) {
        self.live_native_dialogs[dialog.index()] = true;
        if let Some(id) = dialog.replacement_modal() {
            self.raise(id);
        }
    }

    /// Records that a native dialog is gone, and takes the modal standing in for it down with it.
    pub(super) fn native_dialog_closed(&mut self, dialog: NativeDialog) {
        self.live_native_dialogs[dialog.index()] = false;
        if let Some(id) = dialog.replacement_modal() {
            self.remove(id);
        }
    }

    /// The native dialogs behind `id` that are still up, which closing it asks the host to dismiss.
    pub(super) fn live_dialogs_behind(
        &self,
        id: ModalId,
    ) -> impl Iterator<Item = NativeDialog> + '_ {
        id.policy()
            .native_dialogs
            .iter()
            .copied()
            .filter(|&dialog| self.native_dialog_live(dialog))
    }

    /// Leaves `wanted` the only status-driven modal on the stack, taking every input or none as it
    /// says, or leaves none on it where nothing is wanted.
    pub(super) fn sync_status(&mut self, wanted: Option<(ModalId, bool)>) {
        self.entries.retain(|modal| {
            !modal.id.policy().status_driven || Some(modal.id) == wanted.map(|wanted| wanted.0)
        });
        let Some((id, captures_input)) = wanted else {
            return;
        };
        match self.entries.iter_mut().find(|modal| modal.id == id) {
            Some(modal) => modal.captures_input = captures_input,
            None => self.entries.push(Modal { id, captures_input }),
        }
    }

    /// Whether any modal on the stack takes every input.
    pub(super) fn captures_input(&self) -> bool {
        self.entries.iter().any(|modal| modal.captures_input)
    }

    /// Whether every modal taking the player's input lets them chat from under it (see
    /// [`ModalPolicy::allows_chat`]), which with none up they can.
    pub(super) fn chat_allowed(&self) -> bool {
        self.entries
            .iter()
            .filter(|modal| modal.captures_input)
            .all(|modal| modal.id.policy().allows_chat)
    }
}

/// What drawing a modal reported back.
#[derive(Default)]
pub(super) struct ModalOutcome {
    /// Whether the player asked for the modal to close.
    pub(super) dismissed: bool,
    /// Slots whose Drop button was clicked.
    pub(super) drop_requests: Vec<u8>,
    /// Whether the player asked to leave the game, on a surface whose session is already over.
    pub(super) leave: bool,
    /// Whether the player asked to quit a game that is still running.
    pub(super) quit: bool,
    /// Whether the player asked to leave by way of the leave question.
    pub(super) ask_to_leave: bool,
    /// The result dialog whose End Mission the player asked for.
    pub(super) end_mission: Option<NativeDialog>,
    /// Whether the player asked for the alliances screen.
    pub(super) open_alliances: bool,
    /// Whether the player asked for the alliance changes they made to be applied.
    pub(super) apply_alliances: bool,
    /// Whether the player asked for the mission objectives.
    pub(super) open_objectives: bool,
    /// Whether the player asked to pause the game (`true`) or resume it (`false`).
    pub(super) set_paused: Option<bool>,
    /// What the player did on the alliances screen.
    pub(super) alliances_actions: Vec<AlliancesAction>,
    /// The menu the alliances screen should have open, where that changed.
    pub(super) alliances_menu: Option<Option<AlliancesMenu>>,
    /// Whether the player gave up on their own connection.
    pub(super) abandoned: bool,
    /// Whether the player asked for the options screen.
    pub(super) open_options: bool,
    /// The page of the options screen they moved to.
    pub(super) options_section: Option<OptionsSection>,
    /// Settings they moved, in the order they moved them.
    pub(super) options_changes: Vec<SettingChange>,
}

/// The shell's own state a modal is drawn from, as against the view-models its host built.
pub(super) struct ModalContext<'a> {
    pub(super) options: &'a OptionsView,
    pub(super) option_lists: &'a OptionsLists,
    pub(super) options_section: OptionsSection,
    /// Whether a key is holding the drawn modal's hold-to-confirm button.
    pub(super) button_key_held: bool,
    /// What a key pressed since the last frame chose on an end-of-game card.
    pub(super) end_card_key: Option<EndCardChoice>,
    /// The menu open on the alliances screen.
    pub(super) alliances_menu: Option<AlliancesMenu>,
    /// The alliance changes made on the alliances screen and not yet applied.
    pub(super) alliances_draft: &'a AlliancesDraft,
}

/// Draws the modal `id` and reports what the player did with it.
pub(super) fn draw_modal(
    ctx: &Context,
    id: ModalId,
    views: &mut Views<'_>,
    host: &HostFrame,
    shell: &ModalContext<'_>,
    hit_rects: &mut Vec<HitRect>,
) -> ModalOutcome {
    match id {
        ModalId::WaitingForPlayers | ModalId::ConnectionInterrupted | ModalId::SessionEnded => {
            let Some(surface) = views.disconnect.as_ref() else {
                return ModalOutcome::default();
            };
            let dialog = render_disconnect_view(surface.view, ctx, shell.button_key_held);
            // The surface only takes clicks once it has a control to take them for: a passive
            // notice must not cost the game a click.
            if surface.view.has_button() || id == ModalId::ConnectionInterrupted {
                hit_rects.push(HitRect::new(dialog.response.rect));
            }
            ModalOutcome {
                drop_requests: dialog.inner.drop_requests,
                abandoned: dialog.inner.abandoned,
                leave: dialog.inner.leave,
                ..ModalOutcome::default()
            }
        }
        ModalId::GameMenu => {
            let dialog = render_game_menu(
                ctx,
                host.game_seconds,
                host.mode == Mode::Playing,
                host.pause_control,
            );
            hit_rects.push(HitRect::new(dialog.response.rect));
            let asks_first = leave_asks_first(host.mode == Mode::Replay);
            ModalOutcome {
                dismissed: dialog.inner.return_to_game || dialog.scrim_clicked,
                open_options: dialog.inner.open_options,
                open_alliances: dialog.inner.open_alliances,
                open_objectives: dialog.inner.open_objectives,
                set_paused: dialog.inner.set_paused,
                quit: dialog.inner.leave && !asks_first,
                ask_to_leave: dialog.inner.leave && asks_first,
                ..ModalOutcome::default()
            }
        }
        ModalId::LeaveGame => {
            let dialog = render_leave_confirm(ctx, host.mode == Mode::Replay);
            hit_rects.push(HitRect::new(dialog.response.rect));
            ModalOutcome {
                dismissed: dialog.inner.return_to_game || dialog.scrim_clicked,
                quit: dialog.inner.leave,
                ..ModalOutcome::default()
            }
        }
        ModalId::ChatHistory => {
            // A host that has not built the log yet still gets a dialog it can close: an empty one
            // says "no messages", which is the truth as far as this frame knows, and leaving the
            // screen blank would strand the player behind a scrim with nothing to click.
            let empty = ChatHistoryView::default();
            let view = views.chat_history.unwrap_or(&empty);
            let dialog = render_chat_history_view(view, ctx);
            hit_rects.push(HitRect::scrolling(dialog.response.rect));
            ModalOutcome {
                dismissed: dialog.inner || dialog.scrim_clicked,
                ..ModalOutcome::default()
            }
        }
        ModalId::Victory | ModalId::Defeat => {
            // A host that could not build the card's view still gets a card the player can act on:
            // the result is the modal's own, and the clock is the frame's.
            let result = id.end_card_result(host.mode).unwrap_or(GameResult::Defeat);
            let fallback = EndCardView {
                result,
                game_seconds: host.game_seconds,
                stats: None,
                ranks: StatRanks::default(),
                race: None,
            };
            let view = views
                .end_card
                .filter(|view| view.result == result)
                .unwrap_or(&fallback);
            let card = render_end_card(ctx, view, shell.end_card_key);
            hit_rects.push(HitRect::new(card.rect));
            ModalOutcome {
                dismissed: card.choice == Some(EndCardChoice::KeepPlaying),
                end_mission: (card.choice == Some(EndCardChoice::Leave))
                    .then(|| id.policy().native_dialogs.first().copied())
                    .flatten(),
                ..ModalOutcome::default()
            }
        }
        ModalId::Alliances => {
            let Some(view) = views.alliances else {
                // A host that has not built the screen yet still gets a way out: the scrim and the
                // key close it, and nothing else is drawn rather than a table of nobody.
                return ModalOutcome::default();
            };
            let staged = !shell.alliances_draft.is_empty();
            let shown = shell.alliances_draft.applied_to(view);
            let dialog = render_alliances_view(&shown, ctx, shell.alliances_menu, staged);
            hit_rects.push(HitRect::new(dialog.response.rect));
            if let Some(menu) = dialog.inner.menu_rect {
                hit_rects.push(HitRect::new(menu));
            }
            // A click outside the screen while one of its menus is open closes the menu alone, and
            // one while changes wait to be applied does nothing: a stray click must not throw
            // them away.
            let scrim_dismisses = shell.alliances_menu.is_none() && !staged && dialog.scrim_clicked;
            ModalOutcome {
                dismissed: dialog.inner.done || dialog.inner.apply || scrim_dismisses,
                alliances_actions: dialog.inner.actions,
                alliances_menu: dialog.inner.menu,
                apply_alliances: dialog.inner.apply,
                ..ModalOutcome::default()
            }
        }
        ModalId::Options => {
            let dialog = render_options_view(
                shell.options,
                shell.option_lists,
                ctx,
                shell.options_section,
            );
            hit_rects.push(HitRect::scrolling(dialog.response.rect));
            let OptionsOutcome {
                section,
                changes,
                done,
            } = dialog.inner;
            ModalOutcome {
                dismissed: done || dialog.scrim_clicked,
                options_section: section,
                options_changes: changes,
                ..ModalOutcome::default()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use egui::{Key, Modifiers, Rect};

    use super::*;
    use crate::disconnect::SelfState;
    use crate::shell::native_dialogs;
    use crate::shell::test_support::*;
    use crate::shell::{DisconnectSurface, InputCapture, Intent, Shell};

    /// A modal the game's state raises cannot be closed by the player: the next frame would only
    /// raise it again.
    #[test]
    fn a_status_driven_modal_is_never_dismissible() {
        for id in ModalId::ALL {
            let policy = id.policy();
            assert!(!(policy.status_driven && policy.dismissible), "{id:?}");
        }
    }

    /// Each native dialog is stood in for by at most one modal, which is the one its spawn raises,
    /// and every one of them but the stall dialog has one.
    #[test]
    fn each_native_dialog_raises_the_modal_that_stands_in_for_it() {
        for id in ModalId::ALL {
            for &dialog in id.policy().native_dialogs {
                assert_eq!(dialog.replacement_modal(), Some(id), "{dialog:?}");
            }
        }
        for dialog in NativeDialog::ALL {
            assert_eq!(
                dialog.replacement_modal().is_none(),
                dialog == NativeDialog::TimeOut,
                "{dialog:?}"
            );
        }
    }

    #[test]
    fn a_stall_notice_is_modal_without_taking_input() {
        let mut shell = spectating_shell();
        let disconnect = disconnect_view(SelfState::Healthy);
        shell.sync_status_modals(Some(&DisconnectSurface {
            view: &disconnect,
            blocks_input: false,
        }));
        assert_eq!(shell.top_modal(), Some(ModalId::WaitingForPlayers));
        assert_eq!(shell.capture(), InputCapture::PASS_THROUGH);
    }

    #[test]
    fn a_confirmed_disconnect_takes_every_input() {
        let mut shell = spectating_shell();
        let disconnect = disconnect_view(SelfState::Reconnecting);
        shell.sync_status_modals(Some(&DisconnectSurface {
            view: &disconnect,
            blocks_input: true,
        }));
        assert_eq!(shell.top_modal(), Some(ModalId::ConnectionInterrupted));
        assert!(shell.capture().blocks_game_pointer());
    }

    #[test]
    fn a_session_that_is_over_raises_its_own_modal() {
        for self_state in [SelfState::Disconnected, SelfState::Desynced] {
            let mut shell = spectating_shell();
            let disconnect = disconnect_view(self_state);
            shell.sync_status_modals(Some(&DisconnectSurface {
                view: &disconnect,
                blocks_input: true,
            }));
            assert_eq!(shell.top_modal(), Some(ModalId::SessionEnded));
            assert!(!shell.key_pressed(Key::Escape, Modifiers::NONE));
        }
    }

    #[test]
    fn a_status_modal_swaps_rather_than_stacking() {
        let mut shell = spectating_shell();
        let waiting = disconnect_view(SelfState::Healthy);
        shell.sync_status_modals(Some(&DisconnectSurface {
            view: &waiting,
            blocks_input: true,
        }));
        let interrupted = disconnect_view(SelfState::Reconnecting);
        shell.sync_status_modals(Some(&DisconnectSurface {
            view: &interrupted,
            blocks_input: true,
        }));
        assert_eq!(
            shell.open_modals().collect::<Vec<_>>(),
            vec![ModalId::ConnectionInterrupted]
        );
        shell.sync_status_modals(None);
        assert_eq!(shell.top_modal(), None);
    }

    #[test]
    fn escape_never_closes_a_status_modal() {
        let mut shell = spectating_shell();
        let disconnect = disconnect_view(SelfState::Healthy);
        shell.sync_status_modals(Some(&DisconnectSurface {
            view: &disconnect,
            blocks_input: true,
        }));
        assert!(!shell.key_pressed(Key::Escape, Modifiers::NONE));
        assert_eq!(shell.top_modal(), Some(ModalId::WaitingForPlayers));
    }

    #[test]
    fn a_replaced_dialog_opens_its_modal_and_escape_closes_both() {
        let mut shell = spectating_shell();
        shell.native_dialog_spawned(NativeDialog::GameMenu);
        assert_eq!(shell.top_modal(), Some(ModalId::GameMenu));
        assert!(shell.capture().blocks_game_pointer());

        assert!(shell.key_pressed(Key::Escape, Modifiers::NONE));
        assert_eq!(shell.top_modal(), None);
        assert_eq!(
            shell.pending_intents(),
            [Intent::CloseNativeDialog(NativeDialog::GameMenu)]
        );
    }

    #[test]
    fn escape_on_a_victory_card_keeps_playing_through_its_dialog() {
        let mut shell = Shell::new();
        shell.native_dialog_spawned(NativeDialog::Victory);
        assert_eq!(shell.top_modal(), Some(ModalId::Victory));
        assert!(shell.capture().blocks_game_pointer());

        assert!(shell.key_pressed(Key::Escape, Modifiers::NONE));
        assert_eq!(shell.top_modal(), None);
        assert_eq!(
            shell.pending_intents(),
            [Intent::CloseNativeDialog(NativeDialog::Victory)]
        );
        assert_eq!(
            NativeDialog::Victory.return_control_id(),
            native_dialogs::VICTORY_CONTINUE_CONTROL_ID
        );
    }

    #[test]
    fn a_defeat_card_can_only_be_left() {
        let mut shell = Shell::new();
        shell.native_dialog_spawned(NativeDialog::Defeat);
        shell.key_pressed(Key::Escape, Modifiers::NONE);
        assert_eq!(shell.top_modal(), Some(ModalId::Defeat));
        assert!(shell.pending_intents().is_empty());
    }

    #[test]
    fn a_modal_opened_directly_captures_input_and_closes_without_touching_the_game() {
        let mut shell = spectating_shell();
        shell.open_modal(ModalId::ChatHistory);
        assert_eq!(shell.top_modal(), Some(ModalId::ChatHistory));
        assert!(shell.capture().blocks_game_pointer());
        // Opening the same modal twice must not stack two of it, or one Escape would leave the
        // other behind.
        shell.open_modal(ModalId::ChatHistory);
        assert_eq!(shell.open_modals().count(), 1);

        assert!(shell.key_pressed(Key::Escape, Modifiers::NONE));
        assert_eq!(shell.top_modal(), None);
        // No native dialog was ever spawned behind it, so there is nothing to ask the host to close.
        assert!(shell.pending_intents().is_empty());
    }

    #[test]
    fn a_modal_the_game_state_owns_cannot_be_opened_by_hand() {
        let mut shell = spectating_shell();
        shell.open_modal(ModalId::WaitingForPlayers);
        assert_eq!(shell.top_modal(), None);
    }

    #[test]
    fn a_dialog_closing_on_its_own_asks_for_no_dismissal() {
        let mut shell = spectating_shell();
        shell.native_dialog_spawned(NativeDialog::ChatHistory);
        shell.native_dialog_closed(NativeDialog::ChatHistory);
        assert_eq!(shell.top_modal(), None);
        assert!(!shell.native_dialog_live(NativeDialog::ChatHistory));
        assert!(shell.pending_intents().is_empty());
    }

    #[test]
    fn the_timeout_dialog_raises_no_modal_of_its_own() {
        let mut shell = spectating_shell();
        shell.native_dialog_spawned(NativeDialog::TimeOut);
        assert!(shell.native_dialog_live(NativeDialog::TimeOut));
        assert_eq!(shell.top_modal(), None);
    }

    /// The screens the menu opens take its place, as SC:R's do, so putting one away goes back to the
    /// game rather than back to the menu.
    #[test]
    fn a_screen_opened_from_the_menu_takes_its_place() {
        for (key, screen) in [(Key::O, ModalId::Options), (Key::A, ModalId::Alliances)] {
            let mut shell = playing_shell();
            shell.native_dialog_spawned(NativeDialog::GameMenu);
            assert!(shell.key_pressed(key, Modifiers::NONE));
            assert_eq!(shell.open_modals().collect::<Vec<_>>(), vec![screen]);
            // The game's own menu goes with ours, or it would still be up behind the screen.
            assert_eq!(
                shell.pending_intents(),
                [Intent::CloseNativeDialog(NativeDialog::GameMenu)]
            );
            assert!(shell.key_pressed(Key::Escape, Modifiers::NONE));
            assert_eq!(shell.top_modal(), None);
        }
    }

    #[test]
    fn the_end_card_keeps_the_chat_box_shut() {
        let mut shell = playing_shell();
        shell.open_modal(ModalId::Victory);
        let capture = shell.capture();
        assert!(capture.blocks_game_key(Some(Key::Enter)));
        assert!(capture.blocks_game_char());
    }

    #[test]
    fn players_kept_waiting_can_still_talk() {
        let mut shell = playing_shell();
        raise_status_modal(&mut shell, ModalId::WaitingForPlayers);
        let capture = shell.capture();
        assert!(!capture.blocks_game_key(Some(Key::Enter)));
        assert!(!capture.blocks_game_char());
        // Anything else on the stack that keeps the box shut keeps it shut.
        shell.open_modal(ModalId::GameMenu);
        assert!(shell.capture().blocks_game_char());
    }

    #[test]
    fn a_chat_box_left_open_under_a_card_leaves_the_card_its_keys() {
        let mut shell = playing_shell();
        shell.open_modal(ModalId::Victory);
        shell.set_host(&HostFrame {
            mode: Mode::Playing,
            game_started: true,
            native_textbox_open: true,
            ..HostFrame::default()
        });
        assert!(shell.capture().blocks_game_char());
        assert!(shell.key_pressed(Key::E, Modifiers::NONE));
        assert_eq!(shell.end_card_key, Some(EndCardChoice::Leave));
    }

    #[test]
    fn a_chat_box_open_while_players_wait_keeps_its_keys() {
        let mut shell = playing_shell();
        raise_status_modal(&mut shell, ModalId::WaitingForPlayers);
        shell.set_host(&HostFrame {
            mode: Mode::Playing,
            game_started: true,
            native_textbox_open: true,
            ..HostFrame::default()
        });
        assert!(!shell.key_pressed(Key::Escape, Modifiers::NONE));
        assert!(!shell.capture().blocks_game_key(Some(Key::Backspace)));
    }

    /// A menu on the alliances screen can hang past the dialog's edge, and a host only hands the
    /// overlay the clicks inside the rects a frame reports: the menu has to be one of them, or its
    /// rows past the edge light up under the pointer and never take a click.
    #[test]
    fn an_open_alliances_menu_takes_the_pointer_beyond_the_dialog() {
        use crate::alliances::{AlliancesView, ChatTargetChoice, ChatTargetOption};

        let mut shell = Shell::new();
        let host = HostFrame {
            mode: Mode::Playing,
            game_started: true,
            ..HostFrame::default()
        };
        shell.set_host(&host);
        shell.open_modal(ModalId::Alliances);
        let view = AlliancesView {
            players: Vec::new(),
            alliances_open: true,
            allied_victory: false,
            chat_target: ChatTargetChoice::All,
            chat_targets: vec![ChatTargetOption {
                choice: ChatTargetChoice::All,
                recipient: None,
                color: None,
                muted: false,
            }],
        };
        let ctx = egui::Context::default();
        crate::install_fonts_and_style(&ctx, &crate::DynamicFonts::default());
        let run = |shell: &mut Shell| {
            let mut views = Views {
                alliances: Some(&view),
                ..Views::default()
            };
            let raw = egui::RawInput {
                screen_rect: Some(Rect::from_min_size(
                    egui::pos2(0.0, 0.0),
                    egui::vec2(1920.0, 1080.0),
                )),
                ..Default::default()
            };
            ctx.begin_pass(raw);
            let output = shell.frame(&ctx, &host, &mut views);
            // A layout check has no GPU texture store to hand the atlas to.
            ctx.end_pass().textures_delta.clear();
            output.hit_rects.len()
        };
        assert_eq!(run(&mut shell), 1);
        shell.set_alliances_menu(Some(AlliancesMenu::ChatTarget));
        assert_eq!(run(&mut shell), 2);
    }

    /// A watcher's game is simply over, whatever the game's own popup says, and they can keep
    /// watching from it.
    #[test]
    fn a_watchers_end_card_is_game_over() {
        assert_eq!(
            ModalId::Defeat.end_card_result(Mode::Observing),
            Some(GameResult::GameOver)
        );
        assert_eq!(
            ModalId::Victory.end_card_result(Mode::Playing),
            Some(GameResult::Victory)
        );
        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        shell.native_dialog_spawned(NativeDialog::Defeat);
        run_frame_at(&mut shell, &ctx, None, 0.0);
        run_frame_at(&mut shell, &ctx, None, 3.0);
        // The game being watched is over: there is no carrying on, only leaving.
        assert_eq!(
            crate::end_card::key_choice(Key::C, GameResult::GameOver),
            None
        );
        assert_eq!(
            crate::end_card::key_choice(Key::E, GameResult::GameOver),
            Some(EndCardChoice::Leave)
        );
    }
}
