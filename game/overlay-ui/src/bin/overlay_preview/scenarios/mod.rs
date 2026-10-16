//! The set of overlay states the preview can put on the emulated screen.
//!
//! Exactly one scenario is active at a time, matching the game: a screen is either up or it isn't,
//! and stacking two of them would hide whichever anchors to the same corner.
//!
//! A scenario's job is to build the view-models the shell draws from, not to draw them: the shell
//! decides which of them is modal, what the frame takes of the player's input and which rects it
//! owns, exactly as it does in the game. The kitchen sink is the exception, being a specimen sheet
//! of the kit rather than a screen the game ever shows.

pub mod alliances;
pub mod chat_history;
pub mod disconnect;
pub mod kitchen_sink;
pub mod net_quality;
pub mod netstat;
pub mod observer;
pub mod shell;
pub mod transport;

use egui::Context;
use overlay_ui::options::OptionsSection;
use overlay_ui::shell::{
    DisconnectSurface, HitRect, InputCapture, Intent, ModalId, Mode, NativeDialog, Shell, Views,
};
use serde::{Deserialize, Serialize};

use crate::host_knobs;
use crate::knobs::Knobs;

/// Which overlay the emulated screen is showing.
#[derive(Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum ScenarioKind {
    #[default]
    Disconnect,
    NetQuality,
    NetStat,
    ChatHistory,
    Alliances,
    Transport,
    Observer,
    Shell,
    KitchenSink,
}

impl ScenarioKind {
    pub const ALL: [ScenarioKind; 9] = [
        ScenarioKind::Disconnect,
        ScenarioKind::NetQuality,
        ScenarioKind::NetStat,
        ScenarioKind::ChatHistory,
        ScenarioKind::Alliances,
        ScenarioKind::Transport,
        ScenarioKind::Observer,
        ScenarioKind::Shell,
        ScenarioKind::KitchenSink,
    ];

    pub fn label(self) -> &'static str {
        match self {
            ScenarioKind::Disconnect => "Disconnect",
            ScenarioKind::NetQuality => "Network quality",
            ScenarioKind::NetStat => "Network stats",
            ScenarioKind::ChatHistory => "Chat history",
            ScenarioKind::Alliances => "Alliances",
            ScenarioKind::Transport => "Replay transport",
            ScenarioKind::Observer => "Observer panels",
            ScenarioKind::Shell => "Shell",
            ScenarioKind::KitchenSink => "Kitchen sink",
        }
    }

    /// The vantage point this scenario only exists in, which selecting it moves the emulated host
    /// to: a screen the game draws for one mode would otherwise be selected and never appear.
    pub fn required_mode(self) -> Option<Mode> {
        match self {
            // The observer panels exist while observing too; a replay is where the whole set is on
            // screen at once, transport plate included, so that is what selecting them lands on.
            ScenarioKind::Transport | ScenarioKind::Observer => Some(Mode::Replay),
            // Alliances are between players, so there is nothing to set from the stands.
            ScenarioKind::Alliances => Some(Mode::Playing),
            _ => None,
        }
    }

    /// The name this scenario takes in a rendered file name.
    pub fn slug(self) -> &'static str {
        match self {
            ScenarioKind::Disconnect => "disconnect",
            ScenarioKind::NetQuality => "net-quality",
            ScenarioKind::NetStat => "netstat",
            ScenarioKind::ChatHistory => "chat-history",
            ScenarioKind::Alliances => "alliances",
            ScenarioKind::Transport => "transport",
            ScenarioKind::Observer => "observer",
            ScenarioKind::Shell => "shell",
            ScenarioKind::KitchenSink => "kitchen-sink",
        }
    }
}

/// One named state of one scenario, as the offline renderer walks them.
#[derive(Clone, Copy)]
pub enum Preset {
    Disconnect(disconnect::Preset),
    NetQuality(net_quality::Preset),
    NetStat(netstat::Preset),
    ChatHistory(chat_history::Preset),
    Alliances(alliances::Preset),
    Transport(transport::Preset),
    Observer(observer::Preset),
    Shell(shell::Preset),
    KitchenSink(kitchen_sink::Preset),
}

impl Preset {
    pub fn kind(self) -> ScenarioKind {
        match self {
            Preset::Disconnect(_) => ScenarioKind::Disconnect,
            Preset::NetQuality(_) => ScenarioKind::NetQuality,
            Preset::NetStat(_) => ScenarioKind::NetStat,
            Preset::ChatHistory(_) => ScenarioKind::ChatHistory,
            Preset::Alliances(_) => ScenarioKind::Alliances,
            Preset::Transport(_) => ScenarioKind::Transport,
            Preset::Observer(_) => ScenarioKind::Observer,
            Preset::Shell(_) => ScenarioKind::Shell,
            Preset::KitchenSink(_) => ScenarioKind::KitchenSink,
        }
    }

    /// What a render of this preset is filed under, which is also how the selector names it.
    pub fn label(self) -> String {
        match self {
            Preset::Disconnect(preset) => preset.label().to_string(),
            Preset::NetQuality(preset) => preset.label().to_string(),
            Preset::NetStat(preset) => preset.label().to_string(),
            Preset::ChatHistory(preset) => preset.label().to_string(),
            Preset::Alliances(preset) => preset.label().to_string(),
            Preset::Transport(preset) => preset.label().to_string(),
            Preset::Observer(preset) => preset.label(),
            Preset::Shell(preset) => preset.label(),
            Preset::KitchenSink(preset) => preset.label().to_string(),
        }
    }

    /// Moments into this preset's entrance worth rendering as stills of their own; see
    /// [`shell::Preset::timeline`].
    pub fn timeline(self) -> &'static [f64] {
        match self {
            Preset::Shell(preset) => preset.timeline(),
            _ => &[],
        }
    }

    /// How long after it appears this preset has come to rest, for one that takes longer than an
    /// offline render's usual settling.
    pub fn settle_secs(self) -> Option<f64> {
        match self {
            Preset::Shell(preset) => preset.settle_secs(),
            _ => None,
        }
    }

    /// Selects this preset's scenario and presets its knobs.
    pub fn apply(self, knobs: &mut Knobs) {
        knobs.scenario = self.kind();
        match self {
            Preset::Disconnect(preset) => preset.apply(&mut knobs.disconnect),
            Preset::NetQuality(preset) => preset.apply(&mut knobs.net_quality),
            Preset::NetStat(preset) => preset.apply(&mut knobs.netstat),
            Preset::ChatHistory(preset) => preset.apply(knobs),
            Preset::Alliances(preset) => preset.apply(knobs),
            Preset::Transport(preset) => preset.apply(knobs),
            Preset::Observer(preset) => preset.apply(knobs),
            Preset::Shell(preset) => preset.apply(knobs),
            Preset::KitchenSink(preset) => preset.apply(&mut knobs.kitchen_sink),
        }
    }
}

/// The presets that are also rendered offline in the pseudolocale: one per screen that draws
/// translated strings, picked as the busiest state each one has, since that is where long text runs
/// out of room first. The kitchen sink is left out — it is a specimen sheet of the kit, not a screen
/// whose copy is translated.
pub const PSEUDOLOCALE_PRESETS: [Preset; 10] = [
    Preset::Disconnect(disconnect::Preset::Droppable),
    Preset::NetStat(netstat::Preset::Degraded),
    Preset::ChatHistory(chat_history::Preset::Busy),
    Preset::Alliances(alliances::Preset::Crowded),
    Preset::Alliances(alliances::Preset::Staged),
    Preset::Transport(transport::Preset::SpoilerFree),
    Preset::Observer(observer::Preset::game(6, 3, observer::Screen::Analyst)),
    Preset::Shell(shell::Preset::PlayerGameMenu),
    Preset::Shell(shell::Preset::Options(OptionsSection::Gameplay)),
    Preset::Shell(shell::Preset::Victory),
];

/// Every scenario preset, in selector order.
pub fn all_presets() -> Vec<Preset> {
    disconnect::Preset::ALL
        .into_iter()
        .map(Preset::Disconnect)
        .chain(net_quality::Preset::ALL.into_iter().map(Preset::NetQuality))
        .chain(netstat::Preset::ALL.into_iter().map(Preset::NetStat))
        .chain(
            chat_history::Preset::ALL
                .into_iter()
                .map(Preset::ChatHistory),
        )
        .chain(alliances::Preset::ALL.into_iter().map(Preset::Alliances))
        .chain(transport::Preset::ALL.into_iter().map(Preset::Transport))
        .chain(observer::Preset::ALL.into_iter().map(Preset::Observer))
        .chain(shell::Preset::ALL.into_iter().map(Preset::Shell))
        .chain(
            kitchen_sink::Preset::ALL
                .into_iter()
                .map(Preset::KitchenSink),
        )
        .collect()
}

/// Knob-panel state that outlives a frame but isn't worth persisting.
pub struct UiState {
    pub disconnect: disconnect::UiState,
    pub net_quality: net_quality::SimState,
    /// The fake replay the transport drives, which is state the game would own rather than a knob.
    pub transport: transport::Clock,
    /// What the fake game remembers of what the observer panels asked of it.
    pub observer: observer::State,
    /// What the fake game remembers of what the alliances screen asked of it.
    pub alliances: alliances::State,
}

impl UiState {
    pub fn new(knobs: &Knobs) -> UiState {
        UiState {
            disconnect: disconnect::UiState::new(&knobs.disconnect),
            net_quality: net_quality::SimState::new(),
            transport: transport::Clock::new(&knobs.transport),
            observer: observer::State::new(),
            alliances: alliances::State::new(),
        }
    }
}

/// Draws the active scenario on the game context, through the shell.
///
/// `elapsed` is the host's running time in seconds, which scenarios with live counters tick from.
pub fn render(
    knobs: &Knobs,
    state: &mut UiState,
    elapsed: f64,
    ctx: &Context,
    shell: &mut Shell,
) -> Outcome {
    host_knobs::sync_native_dialogs(&knobs.host, shell);

    // The kitchen sink is not a shell surface: it is the kit laid out at once, drawn straight onto
    // the context under whatever the shell puts on top of it.
    if knobs.scenario == ScenarioKind::KitchenSink {
        kitchen_sink::render(&knobs.kitchen_sink, ctx);
    }

    let disconnect_view = (knobs.scenario == ScenarioKind::Disconnect)
        .then(|| disconnect::build_view(&knobs.disconnect, elapsed));
    let net_quality_view = (knobs.scenario == ScenarioKind::NetQuality)
        .then(|| net_quality::build_view(&knobs.net_quality, &mut state.net_quality));
    let net_stats_view = match knobs.scenario {
        ScenarioKind::NetStat => Some(netstat::build_view(&knobs.netstat)),
        ScenarioKind::Shell => shell::ambient_view(&knobs.shell, &knobs.netstat),
        _ => None,
    };
    // Built only while the log's modal is on the stack, the way the DLL builds it: the view is a
    // copy of every line said this game, and nothing but that modal reads it.
    let chat_history_view = shell
        .open_modals()
        .any(|modal| modal == ModalId::ChatHistory)
        .then(|| chat_history::build_view(&knobs.chat_history));
    // Built only while the alliances modal is on the stack, for the same reason.
    let alliances_view = shell
        .open_modals()
        .any(|modal| modal == ModalId::Alliances)
        .then(|| alliances::build_view(&knobs.alliances, &state.alliances));
    if knobs.scenario == ScenarioKind::Alliances
        && state.alliances.menu_applied != Some(knobs.alliances.open_menu)
    {
        state.alliances.menu_applied = Some(knobs.alliances.open_menu);
        shell.set_alliances_menu(alliances::open_menu(&knobs.alliances));
    }
    if knobs.scenario == ScenarioKind::Alliances
        && state.alliances.staged_applied != Some(knobs.alliances.staged_change)
    {
        state.alliances.staged_applied = Some(knobs.alliances.staged_change);
        if let Some(action) = alliances::staged_change(&knobs.alliances) {
            shell.alliances_action(action);
        }
    }
    // Built only while a result card is on the stack, the way the DLL builds it as the card comes
    // up.
    let end_card_view = shell
        .top_modal()
        .and_then(|modal| modal.end_card_result(knobs.host.mode))
        .map(|result| shell::end_card_view(result, knobs.host.game_seconds, knobs.shell.race));
    // Built for every frame of the emulated replay whether or not the plate is on screen, the way
    // the game DLL builds it: the transport keys keep working with the plate hidden. The observer
    // scenario carries it too, because a replay's screen is the whole set at once — the plate is
    // part of what the panels have to share the screen with.
    let transport_view = (matches!(
        knobs.scenario,
        ScenarioKind::Transport | ScenarioKind::Observer
    ) && knobs.host.mode == Mode::Replay)
        .then(|| {
            state.transport.advance(&knobs.transport, elapsed);
            transport::build_view(
                &knobs.transport,
                &state.transport,
                shell.panel_prefs().spoiler_free,
            )
        });
    let observer_view = (knobs.scenario == ScenarioKind::Observer).then(|| {
        // In a replay the two clocks are the same clock: a matchup bar and a transport plate that
        // disagreed about how far into the game it is would be reporting on two different games.
        let game_secs = match &transport_view {
            Some(view) => {
                overlay_ui::transport::frames_to_seconds(view.elapsed_frames, view.game_speed)
            }
            None => u64::from(knobs.observer.start_secs) + elapsed as u64,
        };
        let prefs = shell.panel_prefs();
        observer::build_view(
            &knobs.observer,
            &state.observer,
            knobs.host.mode == Mode::Replay,
            game_secs,
            observer::GraphRequest {
                series: prefs.graph_series,
                per_player: prefs.graph_per_player,
            },
        )
    });
    // The options screen is raised by the shell rather than by a native dialog, so the knob does
    // here what the in-game menu's Options button does in a game.
    shell::sync_options_modal(&knobs.shell, shell);
    let options_view = (knobs.scenario == ScenarioKind::Shell).then_some(knobs.shell.options);
    let option_lists = (knobs.scenario == ScenarioKind::Shell).then(shell::option_lists);
    let mut views = Views {
        disconnect: disconnect_view.as_ref().map(|view| DisconnectSurface {
            view,
            blocks_input: knobs.disconnect.blocks_input,
        }),
        net_quality: net_quality_view.as_ref(),
        net_stats: net_stats_view.as_ref(),
        chat_history: chat_history_view.as_ref(),
        alliances: alliances_view.as_ref(),
        end_card: end_card_view.as_ref(),
        transport: transport_view.as_ref(),
        observer: observer_view.as_ref(),
        options: options_view.as_ref(),
        option_lists: option_lists.as_ref(),
    };

    // The game draws its own minimap under the overlay and tells the shell where it is; the preview
    // has no minimap, so it paints a stand-in where SC:R puts one for a watcher and reports that.
    let mut host = knobs.host.host_frame();
    if knobs.scenario == ScenarioKind::Observer {
        let square = observer::minimap_square(ctx.viewport_rect());
        if shell.panel_prefs().minimap {
            observer::paint_minimap_stand_in(ctx, square);
        }
        host.minimap_rect = Some(square);
        if knobs.observer.vision_picker && !state.observer.vision_picker_opened {
            state.observer.vision_picker_opened = true;
            shell.set_vision_picker_open(true);
        }
    }
    let output = shell.frame(ctx, &host, &mut views);
    if knobs.scenario == ScenarioKind::NetQuality {
        net_quality::paint_stand_ins(&knobs.net_quality, ctx);
    }
    let mut outcome = Outcome {
        hit_rects: output.hit_rects,
        capture: output.capture,
        top_modal: shell.top_modal(),
        ..Outcome::default()
    };
    for intent in output.intents {
        match intent {
            Intent::DropPlayer { slot } => outcome.disconnect_clicks.push(slot),
            // Leaving a game is the host's to carry out; the preview has no game to leave, so it
            // only reports what was asked for.
            Intent::AbandonGame => outcome.abandoned = true,
            Intent::LeaveGame | Intent::QuitGame | Intent::EndMission(_) => outcome.left = true,
            // The fake game keeps the alliances and chat settings, so the next frame shows them.
            Intent::Alliances(action) => state.alliances.apply(&knobs.alliances, action),
            // The emulated game has no clock to stop.
            Intent::SetPaused(_) => {}
            // The game answers this by spawning its menu, which the overlay's own replaces; here the
            // switch standing in for that spawn is what moves.
            Intent::OpenGameMenu => outcome.open_game_menu = true,
            // The emulated game has no map to have objectives for.
            Intent::OpenObjectives => {}
            // The emulated game has no settings to write, so a change is only reported: the shell
            // is already showing it, which is what the screen is being looked at for.
            Intent::ChangeSetting(change) => outcome.setting_changes.push(change),
            Intent::CloseNativeDialog(dialog) => outcome.close_native_dialogs.push(dialog),
            // The fake replay answers these, the way the game answers them by moving its own clock.
            Intent::Seek(frame) => state.transport.seek_to(frame),
            // The emulated game has no map to look at, and no units to select.
            Intent::LookAt(_)
            | Intent::SelectControlGroup { .. }
            | Intent::PickSelectedUnit(_)
            | Intent::FollowSelectedUnit(_) => {}
            Intent::SetSpeed {
                speed_index,
                multiplier,
                paused,
            } => state.transport.set_speed(speed_index, multiplier, paused),
            // The fake game answers these the way the real one does: vision changes what the
            // watcher is shown, and a selection is what the game would put in its console.
            Intent::ToggleVision { player_id } => state.observer.toggle_vision(player_id),
            Intent::SelectProduction { player_id, item } => {
                state.observer.note_selection(player_id, item as usize)
            }
        }
    }
    outcome
}

/// Whether the active scenario changes from frame to frame on its own, so the host has to keep
/// asking for frames: the game context can't predict numbers the host feeds in.
pub fn is_live(knobs: &Knobs) -> bool {
    knobs.disconnect.auto_tick
        || (knobs.scenario == ScenarioKind::NetQuality && knobs.net_quality.simulate)
}

/// What the active scenario reported back this frame, the way the DLL collects intents from a
/// rendered overlay.
#[derive(Default)]
pub struct Outcome {
    /// Slots whose Drop button was clicked.
    pub disconnect_clicks: Vec<u8>,
    /// Whether the player held the abandon control on the self-reconnecting notice down to the end.
    pub abandoned: bool,
    /// Whether the player clicked Leave on a session-ended notice.
    pub left: bool,
    /// Settings the options screen reported moved, which a game would write through to SC:R.
    pub setting_changes: Vec<overlay_ui::options::SettingChange>,
    /// Native dialogs the shell wants dismissed, because the surface standing in for one was closed.
    /// The game DLL drives the real dialog's return control; the preview closes the switch that
    /// stands in for it.
    pub close_native_dialogs: Vec<NativeDialog>,
    /// Whether the overlay asked for the game's menu, which a game answers by spawning it.
    pub open_game_menu: bool,
    /// The rects the shell reports as its own this frame, in the emulated screen's points.
    pub hit_rects: Vec<HitRect>,
    pub capture: InputCapture,
    pub top_modal: Option<ModalId>,
}

/// The selector plus the active scenario's knob section. Returns whether anything changed.
pub fn knobs_ui(knobs: &mut Knobs, state: &mut UiState, ui: &mut egui::Ui) -> bool {
    let mut changed = false;
    ui.horizontal_wrapped(|ui| {
        for kind in ScenarioKind::ALL {
            if ui
                .selectable_value(&mut knobs.scenario, kind, kind.label())
                .changed()
            {
                changed = true;
                if let Some(mode) = kind.required_mode() {
                    knobs.host.mode = mode;
                }
                // The log's modal is raised by the native dialog it replaces, so picking the
                // scenario spawns that dialog; the host knobs can close it again.
                if kind == ScenarioKind::ChatHistory {
                    knobs.host.chat_history_spawned = true;
                }
                // The same goes for the alliances screen and the alliance filter it replaces.
                if kind == ScenarioKind::Alliances {
                    knobs.host.alliance_filter_spawned = true;
                }
            }
        }
    });
    ui.separator();
    changed |= match knobs.scenario {
        ScenarioKind::Disconnect => {
            disconnect::knobs_ui(&mut knobs.disconnect, &mut state.disconnect, ui)
        }
        ScenarioKind::NetQuality => {
            net_quality::knobs_ui(&mut knobs.net_quality, &state.net_quality, ui)
        }
        ScenarioKind::NetStat => netstat::knobs_ui(&mut knobs.netstat, ui),
        ScenarioKind::ChatHistory => chat_history::knobs_ui(&mut knobs.chat_history, ui),
        ScenarioKind::Alliances => {
            alliances::knobs_ui(&mut knobs.alliances, &mut state.alliances, ui)
        }
        ScenarioKind::Transport => transport::knobs_ui(&mut knobs.transport, ui),
        ScenarioKind::Observer => observer::knobs_ui(&mut knobs.observer, &state.observer, ui),
        ScenarioKind::Shell => shell::knobs_ui(&mut knobs.shell, ui),
        ScenarioKind::KitchenSink => {
            kitchen_sink::knobs_ui(&mut knobs.kitchen_sink, &mut knobs.screen.compact_ramp, ui)
        }
    };
    changed
}
