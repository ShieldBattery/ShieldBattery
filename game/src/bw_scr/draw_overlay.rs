use std::borrow::Cow;
use std::mem;
use std::path::Path;
use std::ptr::NonNull;
use std::time::Instant;

use bw_dat::dialog::{Control, Dialog};
use bw_dat::{Race, Unit};
use egui::epaint;
use egui::{Color32, Event, Key, PointerButton, Pos2, Rect, Slider, pos2};
use overlay_ui::observer::{
    GraphGrouping, MatchupForm, MatchupPlayerView, MatchupView, ObserverView, RaceView,
};
use overlay_ui::shell::{
    DisconnectSurface, FrameOutput, HostFrame, InputCapture, Intent, ModalId, Mode, NativeDialog,
    Shell, Views,
};
use overlay_ui::transport::{self, TransportView};
use parking_lot::Mutex;
use rally_point_client::proto::ids::SlotId;
use winapi::shared::windef::{HWND, POINT};

use crate::app_messages::GameSetupInfo;
use crate::bw;
use crate::bw::apm_stats::ApmStats;
use crate::bw_scr::game_stats::GameStats;
use crate::bw_scr::replay_transport::{ReplayCommand, TransportState};
use crate::bw_scr::{BwCursorType, dialog_hook};
use crate::netcode_v2::{self, DisconnectStatus, NetStatsStatus};

use self::chat_history::ChatHistoryCache;
use self::production::ProductionState;

// The overlay's fonts, colours, and disconnect presentation live in the host-compilable `overlay-ui`
// crate; re-exported here so the DLL's other overlays keep referring to them by the same paths.
pub use overlay_ui::{colors, fonts};

mod chat_history;
mod disconnect;
mod loading_screen;
mod netstat;
mod production;
mod stats;

pub struct OverlayState {
    ctx: egui::Context,
    start_time: Instant,
    /// Enables / disables UI interaction during OverlayState::step.
    /// Based on what BW dialogs are visible.
    ui_active: bool,
    ui_rects: Vec<UiRect>,
    events: Vec<Event>,
    production: ProductionState,
    /// The host-agnostic policy layer: which surfaces are up, which of them is modal, and what the
    /// game is allowed to see of the player's input.
    shell: Shell,
    /// What the last [`step`](Self::step) decided the game may see of the input arriving now.
    /// [`window_proc`](Self::window_proc) runs between frames, so it reads this rather than deciding
    /// for itself.
    capture: InputCapture,
    /// Which replaced native dialogs were live as of the last [`step`](Self::step), so the shell
    /// hears about a spawn or a delete exactly once.
    native_dialogs_live: [bool; NativeDialog::ALL.len()],
    /// The chat log the last frame handed the shell, kept only while its modal is on screen.
    chat_history: Option<ChatHistoryCache>,
    out_state: OutState,
    window_size: (u32, u32),
    /// If (and only if) a mouse button down event was captured,
    /// capture the up event as well.
    captured_mouse_down: [bool; 2],
    /// Keep track if mouse button is down even when it wasn't started on
    /// top of overlay rects.
    mouse_down: [bool; 2],
    /// Size told to egui. Currently render target size which seems to
    /// be always for 1080x1920 window (Width depends on SD/HD though)
    screen_size: (u32, u32),
    /// Winapi coords, egui coords
    last_mouse_pos: ((i16, i16), Pos2),
    replay_ui_values: ReplayUiValues,
    player_vision_was_auto_disabled: [bool; 8],
    replay_start_handled: bool,
    draw_layer: u16,
    dialog_debug_inspect_children: bool,
    was_loading: bool,
    /// When this client's own relay link was first reported down, so the self-notice can say how
    /// long it has been. The turn state reports only that the link is down, and a clock started
    /// from the first frame that says so is the same clock either way.
    self_link_lost_since: Option<Instant>,
}

struct UiRect {
    area: Rect,
    /// Currently and probably forever only true for the debug window.
    capture_mouse_scroll: bool,
}

/// Where the game's own replay controls plate is nudged to, which is the one piece of BW's
/// interface the overlay places rather than replaces. Tuned from the debug window.
struct ReplayUiValues {
    statbtn_dialog_offset: (i32, i32),
}

/// State that will be in StepOutput; mutated through &mut self
/// during child functions of step()
struct OutState {
    replay_visions: u8,
    select_unit: Option<Unit>,
    // true => show, false => hide
    show_hide_control: Option<(Control, bool)>,
    show_hide_graphic_layer: Option<(u8, bool)>,
}

pub struct StepOutput {
    pub textures_delta: egui::TexturesDelta,
    // (draw layer, primitive data)
    pub primitives: Vec<(u16, Vec<egui::ClippedPrimitive>)>,
    pub replay_visions: u8,
    pub select_unit: Option<Unit>,
    // true => show, false => hide
    pub show_hide_control: Option<(Control, bool)>,
    pub show_hide_graphic_layer: Option<(u8, bool)>,
    pub statbtn_dialog_offset: (i32, i32),
    /// Whether BW's bottom console should be on screen, and whether its minimap should be. Two
    /// states rather than one: an observer routinely keeps the minimap while hiding the console.
    pub console_visible: bool,
    pub minimap_visible: bool,
    /// Whether BW's own replay controls should be on screen, which is exactly when the overlay's
    /// transport plate is not: the two stand in the same corner and do the same job.
    pub command_panel_visible: bool,
    /// What the overlay wants done to replay playback this frame, in the order it asked.
    pub replay_commands: Vec<ReplayCommand>,
    // true to run second draw to avoid ugly flickering due to screen size changing.
    pub run_second_draw: bool,
}

/// Bw globals used by OverlayState::step
pub struct BwVars {
    pub is_replay_or_obs: bool,
    pub is_replay: bool,
    pub is_team_game: bool,
    pub game: bw_dat::Game,
    pub players: *mut bw::Player,
    pub main_palette: *mut u8,
    pub rgb_colors: *mut [[f32; 4]; 8],
    pub use_rgb_colors: u8,
    pub replay_visions: u8,
    pub active_units: bw::unit::UnitIterator,
    /// Every unit slot the game has, which is the only thing a unique id can be resolved against:
    /// the units inside a transport or a bunker are named by id rather than by pointer. `None`
    /// before the game has allocated the array.
    pub units: Option<bw_dat::UnitArray>,
    /// What the local client has selected, in the game's own order: the first entry is the unit the
    /// game treats as the selection's subject. Read fresh for every frame, since a selection changes
    /// between frames and the panel that draws it must never be a frame behind the console.
    pub client_selection: [Option<Unit>; 12],
    pub first_player_unit: *mut *mut bw::Unit,
    pub first_dialog: Option<Dialog>,
    pub graphic_layers: Option<NonNull<bw::GraphicLayer>>,
    pub is_hd: bool,
    pub has_init_bw: bool,
    pub countdown_start: Option<Instant>,
    pub game_started: bool,
    /// The `players[]` index the local client is playing from, which is what decides whose side a
    /// player is on and whose row the disconnect surface leaves out.
    pub local_player_id: u8,
    /// The replay's own header numbers, and how playback is running, for the transport plate.
    /// `None` outside a replay, which is every mode the plate is not drawn in.
    pub replay: Option<ReplayVars>,
}

/// What the replay transport needs of the game: the replay's length and recorded speed, from its
/// header, and the playback state the command-stream hook has tracked.
#[derive(Copy, Clone)]
pub struct ReplayVars {
    pub end_frame: u32,
    pub game_speed: u8,
    pub transport: TransportState,
}

#[derive(Copy, Clone)]
pub enum Texture {
    StatRes(u16),
    CmdIcon(u16),
}

// No real reason to start with 0x2000_0000, but since egui gives u64 range,
// might as well not start from 0.
const TEXTURE_FIRST_STATRES: u64 = 0x2000_0000;
const TEXTURE_LAST_STATRES: u64 = TEXTURE_FIRST_STATRES + 0xffff;
const TEXTURE_FIRST_CMDICON: u64 = TEXTURE_LAST_STATRES + 1;
const TEXTURE_LAST_CMDICON: u64 = TEXTURE_FIRST_CMDICON + 0xffff;

impl Texture {
    pub fn to_egui_id(self) -> u64 {
        match self {
            Texture::StatRes(frame) => TEXTURE_FIRST_STATRES + frame as u64,
            Texture::CmdIcon(frame) => TEXTURE_FIRST_CMDICON + frame as u64,
        }
    }

    pub fn from_egui_user_id(val: u64) -> Option<Texture> {
        Some(match val {
            TEXTURE_FIRST_STATRES..=TEXTURE_LAST_STATRES => {
                Texture::StatRes((val - TEXTURE_FIRST_STATRES) as u16)
            }
            TEXTURE_FIRST_CMDICON..=TEXTURE_LAST_CMDICON => {
                Texture::CmdIcon((val - TEXTURE_FIRST_CMDICON) as u16)
            }
            _ => return None,
        })
    }
}

/// Reads the font files that ship beside this DLL rather than inside it.
///
/// The Korean and Simplified Chinese faces are megabytes each, so they are installed next to the
/// DLL instead of embedded. Anything missing there is simply not loaded: the embedded faces still
/// cover Latin, Cyrillic and common Hangul, and an overlay with a few missing glyphs beats no
/// overlay at all.
fn load_dynamic_fonts() -> overlay_ui::DynamicFonts {
    let Some((module_path, _)) = crate::windows::module_from_address(load_dynamic_fonts as *mut _)
    else {
        return overlay_ui::DynamicFonts::default();
    };
    let Some(directory) = Path::new(&module_path).parent() else {
        return overlay_ui::DynamicFonts::default();
    };
    overlay_ui::load_dynamic_fonts(&directory.join(overlay_ui::fonts::DYNAMIC_FONT_DIR))
}

const fn get_normal_draw_layer() -> u16 {
    // - 26 is the first layer that is drawn above minimap
    // (Or maybe a tie with later draw taking prioriry)
    // - 22 is first above F10 menu
    // - 20 is first above the console UI
    // Since egui doesn't really have a way (for now?) to tell some
    // of the output to be drawn on different layer from others
    // (Other than managing multiple `egui::Context`s and drawing output
    // from different context on different layer),
    // going to set the layer higher on debug builds so that the debug
    // window is nicer to use.
    // Layer 19 as default could be fine too, but probably better to
    // go bit over BW console UI if our UI ever ends up being that big.
    if cfg!(debug_assertions) { 26 } else { 21 }
}

impl OverlayState {
    pub fn new() -> OverlayState {
        let ctx = egui::Context::default();

        egui_extras::install_image_loaders(&ctx);

        // Fonts and base style come from the overlay-ui crate, so the host preview renders text
        // identically to the game.
        overlay_ui::install_fonts_and_style(&ctx, &load_dynamic_fonts());

        OverlayState {
            ctx,
            start_time: Instant::now(),
            ui_active: false,
            ui_rects: Vec::new(),
            events: Vec::new(),
            production: ProductionState::new(),
            shell: Shell::new(),
            capture: InputCapture::PASS_THROUGH,
            native_dialogs_live: [false; NativeDialog::ALL.len()],
            out_state: OutState {
                replay_visions: 0,
                select_unit: None,
                show_hide_control: None,
                show_hide_graphic_layer: None,
            },
            captured_mouse_down: [false; 2],
            mouse_down: [false; 2],
            window_size: (100, 100),
            screen_size: (100, 100),
            last_mouse_pos: ((0, 0), Pos2 { x: 0.0, y: 0.0 }),
            replay_ui_values: ReplayUiValues {
                statbtn_dialog_offset: (0, 0),
            },
            player_vision_was_auto_disabled: [false; 8],
            replay_start_handled: false,
            draw_layer: get_normal_draw_layer(),
            dialog_debug_inspect_children: false,
            was_loading: false,
            self_link_lost_since: None,
            chat_history: None,
        }
    }

    pub fn step(
        &mut self,
        bw: &BwVars,
        apm: Option<&ApmStats>,
        game_stats: Option<&GameStats>,
        screen_size: (u32, u32),
        setup_info: Option<&GameSetupInfo>,
        disconnect_status: &DisconnectStatus,
        net_stats: Option<&NetStatsStatus>,
        chat_history: &Mutex<crate::bw_scr::chat_history::ChatHistory>,
    ) -> StepOutput {
        // BW seems to use different render target sizes depending on SD/HD/4k
        // sprites; with 1280x960 for SD, 1920x1080 for lowres HD, and
        // 3840x2160 for 4k HD?
        // Or i'm not actually sure how it decides this; sometimes i'm seeing 1080p
        // render target and other times 1706x960 on HD with 1080p screen?
        // And 3412x1920 when forcing 4k assets..
        //
        // Going to have egui resolution be at most 1080 points tall with increased
        // pixel density for consistent look on HD, and have the UI on lower resolutions
        // just take bit more space so that it gets 1.0 pixels:point ratio too.
        //
        // This'll also prevent division by 0 if screen_size is (0, 0) for some reason.
        let pixels_per_point = if screen_size.1 > 1080 {
            screen_size.1 as f32 / 1080.0
        } else {
            1.0
        };
        self.ctx.set_pixels_per_point(pixels_per_point);

        // This exists for the weird 3412x1920 render target, since
        // 3412.0 / (1920.0 / 1080.0) ~= 1919.25
        // The odd width didn't seem to any issues, but think
        // that valid resolutions should always have even widths anyway.
        fn round_to_even(input: f32) -> f32 {
            let rounded = input.round();
            // This obviously breaks things on floats that don't fit to u32,
            // but resolution floats are fine..
            if (rounded as u32) & 1 == 0 {
                rounded
            } else if input < rounded {
                rounded - 1.0
            } else {
                rounded + 1.0
            }
        }

        let screen_size = (
            round_to_even(screen_size.0 as f32 / pixels_per_point) as u32,
            (screen_size.1 as f32 / pixels_per_point).round() as u32,
        );
        let screen_size_changed = self.screen_size != screen_size;
        self.screen_size = screen_size;
        let screen_rect = Rect {
            min: Pos2 { x: 0.0, y: 0.0 },
            max: Pos2 {
                x: screen_size.0 as f32,
                y: screen_size.1 as f32,
            },
        };
        let time = self.start_time.elapsed().as_secs_f64();
        let mut events = mem::take(&mut self.events);
        events.push(Event::ModifiersChanged(current_egui_modifiers()));
        let focused = true;
        let input = egui::RawInput {
            screen_rect: Some(screen_rect),
            // BW doesn't guarantee texture larger than 2048 pixels working
            // (But it depends on user's system)
            max_texture_side: Some(2048),
            time: Some(time),
            predicted_dt: 1.0 / 60.0,
            events,
            hovered_files: Vec::new(),
            dropped_files: Vec::new(),
            focused,
            ..Default::default()
        };
        self.ui_rects.clear();
        self.ui_active = if let Some(dialog) = bw.first_dialog {
            // Checking if "Minimap" is the first dialog *should* be a good way
            // to figure out if there are any BW menus open, as they *should*
            // be placed as the first dialog, before minimap.
            // Scanning the dialog list for the following names would be more
            // fool-proof though (But how complete is this list? At least it is
            // missing surrender menu, victory / defeat popups, anything else?)
            // GameMenu
            // HelpMenu
            // Help
            // Tips_Dlg
            // ObjectDlg
            // AbrtMenu
            // QuitRepl
            // Quit
            // IDD_OPTIONS_POPUP
            dialog.as_control().string() == "Minimap"
        } else {
            true
        };
        let ctx = self.ctx.clone();
        self.out_state = OutState {
            replay_visions: bw.replay_visions,
            select_unit: None,
            show_hide_control: None,
            show_hide_graphic_layer: None,
        };
        let chat_textbox_open = bw::iter_dialogs(bw.first_dialog)
            .find(|x| x.as_control().string() == "TextBox")
            .and_then(|chat_dlg| chat_dlg.children().find(|x| x.id() == 7))
            .map(|entry_textbox_ctrl| !entry_textbox_ctrl.is_hidden())
            .unwrap_or(false);
        let host_frame = HostFrame {
            mode: if bw.is_replay {
                Mode::Replay
            } else if bw.is_replay_or_obs {
                Mode::Observing
            } else {
                Mode::Playing
            },
            game_started: bw.game_started,
            native_textbox_open: chat_textbox_open,
            // `ui_active` is exactly "no BW menu is sitting on top of the game", which is when the
            // keyboard is BW's rather than ours.
            native_dialog_open: !self.ui_active,
            game_seconds: transport::frames_to_seconds(
                bw.game.frame_count(),
                bw.replay
                    .map_or(FASTEST_GAME_SPEED, |replay| replay.game_speed),
            ),
        };
        // Keypresses arrive between frames and are decided against this, so it is refreshed even on
        // the frames the shell draws nothing on.
        self.shell.set_host(&host_frame);
        self.sync_native_dialogs();
        let users = setup_info.map(|info| info.users.as_slice()).unwrap_or(&[]);
        let now = Instant::now();
        let self_lost = disconnect_status.self_state(now) != netcode_v2::SelfState::Healthy;
        let self_since = match (self_lost, self.self_link_lost_since) {
            (true, Some(since)) => Some(since),
            (true, None) => Some(now),
            (false, _) => None,
        };
        self.self_link_lost_since = self_since;
        let disconnect_view = disconnect::build_disconnect_view(
            disconnect_status,
            users,
            &self.disconnect_roster(bw, disconnect_status, now),
            self_since.map_or(0, |since| now.saturating_duration_since(since).as_secs()),
            now,
        );
        let net_stats_view = net_stats.map(|status| netstat::build_netstat_view(status, users));
        // The log is built only while its modal is up, and lives beside the shell for the frame
        // rather than inside `self`: the render closure below takes `self` mutably, so a view it
        // reads cannot be borrowed out of a field.
        let chat_history_view = if self
            .shell
            .open_modals()
            .any(|modal| modal == ModalId::ChatHistory)
        {
            Some(ChatHistoryCache::build(
                self.chat_history.take(),
                chat_history,
                bw,
            ))
        } else {
            self.chat_history = None;
            None
        };
        // Read before the views are built rather than while they are drawn: the panels report on
        // the frame that is being drawn, and a production list sampled after it would be one frame
        // behind everything beside it.
        if bw.game_started && bw.is_replay_or_obs {
            self.update_replay_state(bw);
        }
        // Built for every frame the client is watching rather than playing, whether or not any
        // panel is on screen: the keys that show them arrive between frames, and only the shell
        // knows which of them the watcher has hidden.
        let observer_view = (bw.game_started && bw.is_replay_or_obs).then(|| {
            let players = stats::stats_players(bw);
            let prefs = self.shell.panel_prefs();
            let series = prefs.graph_series;
            let matchup = self.build_matchup_view(bw, apm);
            // A game with one player per side plots the same lines either way, so it is told there
            // is no grouping to name rather than titled with a distinction it does not have.
            let grouping = matchup.has_teams().then_some(if prefs.graph_per_player {
                GraphGrouping::Players
            } else {
                GraphGrouping::Teams
            });
            ObserverView {
                // The corner cards are what a game the bar has no halves for is read from instead.
                // They are cut from the game exactly where the bar would have cut it, so the same
                // players end up on the same side of the screen either way.
                team_cards: (matchup.form() == MatchupForm::ClockOnly)
                    .then(|| stats::build_team_cards_view(&matchup, &players, game_stats)),
                economy: stats::build_economy_view(&players, game_stats),
                military: stats::build_military_view(&players, game_stats),
                graphs: stats::build_graphs_view(bw, &players, game_stats, series, grouping),
                timeline: stats::build_timeline_view(bw, &players, game_stats),
                production: self.build_production_view(bw),
                control_groups: stats::build_control_groups_view(bw, &players, game_stats),
                selection: stats::build_selection_view(bw, &players),
                // The game keeps no measurement of who holds the map, and one invented here would
                // be a claim rather than a reading. The bar is simply not drawn until there is one.
                map_control: None,
                matchup,
            }
        });
        // Built for every frame of a replay whether or not the plate is on screen: the transport
        // keys keep working with it hidden, and only the shell knows whether the player hid it.
        let transport_view = bw.replay.map(|replay| TransportView {
            elapsed_frames: bw.game.frame_count(),
            end_frames: replay.end_frame,
            game_speed: replay.game_speed,
            paused: replay.transport.paused,
            speed_index: replay.transport.speed_index,
            multiplier: replay.transport.multiplier,
            spoiler_free: self.shell.panel_prefs().spoiler_free,
            seek_pending: replay.transport.seek_pending,
        });
        let mut views = Views {
            disconnect: (!disconnect_view.is_empty()).then(|| DisconnectSurface {
                view: &disconnect_view,
                // Only a real connection problem (our own link down, or a relay-confirmed peer drop)
                // takes the player's input; never the brief stall-only tier, so a passing latency
                // jitter can't lock them out of their own game.
                blocks_input: disconnect_status.is_blocking(),
            }),
            net_stats: net_stats_view.as_ref(),
            chat_history: chat_history_view.as_ref().map(ChatHistoryCache::view),
            transport: transport_view.as_ref(),
            observer: observer_view.as_ref(),
        };
        // Left at its default on a frame the shell doesn't draw, which is a frame that takes none
        // of the player's input and asks nothing of the game.
        let mut frame_output = FrameOutput::default();
        // `run_ui` replaced `Context::run` in egui 0.34: it hands the callback a root `Ui` covering
        // the whole screen (no margin/background) instead of the bare `&Context`. Floating Windows
        // and Areas still attach to the context (`&ctx`); only the loading screen's `CentralPanel`
        // needs the root `Ui`, so it alone is threaded `ui`.
        let output = ctx.run_ui(input, |ui| {
            if bw.game_started {
                if self.was_loading {
                    self.draw_layer = get_normal_draw_layer();
                    self.was_loading = false;
                    // Free up all the loading screen images since we'll never need them again
                    ctx.forget_all_images();
                }

                // Every surface of ours is the shell's: the observer panels, the replay
                // transport, the disconnect surface, the `/netstat` diagnostic panel and whatever
                // modal owns the screen. Its rects are registered unconditionally: a BW dialog
                // sitting on the stack (the hidden `TimeOut` among them) must never be able to
                // steal a click from a modal of ours.
                frame_output = self.shell.frame(&ctx, &host_frame, &mut views);
                for hit in &frame_output.hit_rects {
                    self.ui_rects.push(UiRect {
                        area: hit.rect,
                        capture_mouse_scroll: hit.captures_scroll,
                    });
                }
                let debug = cfg!(debug_assertions);
                if debug {
                    self.add_debug_ui(bw, &ctx);
                }
            } else {
                // Draw the loading UI higher so it hides everything BW may draw (FPS counter, etc.)
                self.draw_layer = 26;
                self.was_loading = true;
                self.add_loading_screen_ui(bw, setup_info, ui);
            }
        });
        self.chat_history = chat_history_view;
        self.capture = frame_output.capture;
        let mut replay_commands = Vec::new();
        for intent in frame_output.intents {
            self.execute_intent(bw, intent, &mut replay_commands);
        }
        let prefs = *self.shell.panel_prefs();
        let ui_primitives = self.ctx.tessellate(output.shapes, pixels_per_point);
        let mut primitives = Vec::with_capacity(8);
        if bw.is_replay && prefs.console {
            let rect = self.make_button_panel_rect(bw, pixels_per_point);
            primitives.push((21, rect));
        }
        primitives.push((self.draw_layer, ui_primitives));
        StepOutput {
            textures_delta: output.textures_delta,
            primitives,
            replay_visions: self.out_state.replay_visions,
            select_unit: self.out_state.select_unit,
            show_hide_control: self.out_state.show_hide_control,
            show_hide_graphic_layer: self.out_state.show_hide_graphic_layer,
            console_visible: prefs.console,
            minimap_visible: prefs.minimap,
            command_panel_visible: !frame_output.transport_shown,
            replay_commands,
            statbtn_dialog_offset: self.replay_ui_values.statbtn_dialog_offset,
            run_second_draw: screen_size_changed,
        }
    }

    /// Tells the shell about every replaced native dialog that has spawned or been deleted since
    /// the last frame. The spawn hook records the dialogs as they come and go; the transitions are
    /// what the shell's modal stack is built from.
    fn sync_native_dialogs(&mut self) {
        let live = dialog_hook::live_replaced_dialogs();
        for dialog in NativeDialog::ALL {
            let index = dialog.index();
            if live[index] == self.native_dialogs_live[index] {
                continue;
            }
            self.native_dialogs_live[index] = live[index];
            if live[index] {
                self.shell.native_dialog_spawned(dialog);
            } else {
                self.shell.native_dialog_closed(dialog);
            }
        }
    }

    /// Draws a black rectangle behind replay UI buttons as it doesn't have proper black
    /// background otherwise.
    fn make_button_panel_rect(
        &mut self,
        bw: &BwVars,
        pixels_per_point: f32,
    ) -> Vec<egui::ClippedPrimitive> {
        let mut shapes = Vec::new();
        let full_clip_rect = Rect::from_two_pos(
            pos2(0.0, 0.0),
            pos2(self.screen_size.0 as f32, self.screen_size.1 as f32),
        );

        let statbtn_dialog =
            bw::iter_dialogs(bw.first_dialog).find(|x| x.as_control().string() == "StatBtn");
        if let Some(dialog) = statbtn_dialog {
            let ctrl = dialog.as_control();
            if !ctrl.is_hidden() {
                let area = ctrl.screen_coords();
                let max_x = self.bw_dialog_coords_max_x() as i16;
                let rect = epaint::RectShape::new(
                    Rect::from_two_pos(
                        // left - 1 just since otherwise there'd be a thin column of lighter
                        // pixels left there.
                        self.bw_dialog_point_to_egui(area.left - 1, area.top),
                        // Dialog goes off the screen unless using minimap-on-center layout;
                        // clamp to screen width so that border stays visible.
                        self.bw_dialog_point_to_egui(area.right.min(max_x), 480),
                    ),
                    egui::CornerRadius::same(2),
                    Color32::BLACK,
                    egui::Stroke::new(2.0, Color32::DARK_GREEN),
                    egui::StrokeKind::Inside,
                );
                shapes.push(epaint::ClippedShape {
                    clip_rect: full_clip_rect,
                    shape: rect.into(),
                });
            }
        }
        self.ctx.tessellate(shapes, pixels_per_point)
    }

    fn bw_dialog_coords_max_x(&self) -> f32 {
        // BW dialog coordinates are in 640x480-range if aspect ratio is 4:3,
        // and for wider aspect ratios Y range stays 480 while X range grows.
        let aspect_ratio = self.screen_size.0 as f32 / self.screen_size.1 as f32;
        480.0 * aspect_ratio
    }

    fn bw_dialog_point_to_egui(&self, x: i16, y: i16) -> egui::Pos2 {
        let max_x = self.bw_dialog_coords_max_x();
        let x = ((x as f32) / max_x) * self.screen_size.0 as f32;
        let y = ((y as f32) / 480.0) * self.screen_size.1 as f32;
        pos2(x, y)
    }

    fn add_debug_ui(&mut self, bw: &BwVars, ctx: &egui::Context) {
        let res = egui::Window::new("Debug")
            // Kept clear of the top-left corner, where the game draws its own fps/turn-rate/latency
            // readout when those displays are enabled.
            .default_pos((260.0, 0.0))
            .default_open(false)
            .movable(true)
            .show(ctx, |ui| {
                egui::ScrollArea::vertical()
                    .max_height(self.screen_size.1 as f32 * 0.9)
                    .show(ui, |ui| {
                        self.add_debug_ui_contents(bw, ctx, ui);
                    });
            });
        self.force_add_ui_rect(&res, true);
    }

    fn add_debug_ui_contents(&mut self, bw: &BwVars, ctx: &egui::Context, ui: &mut egui::Ui) {
        ui.collapsing("Egui settings", |ui| {
            ctx.settings_ui(ui);
        });
        ui.collapsing("Replay UI", |ui| {
            let v = &mut self.replay_ui_values;
            for (var, text) in [
                (&mut v.statbtn_dialog_offset.0, "Statbtn dialog X"),
                (&mut v.statbtn_dialog_offset.1, "Statbtn dialog Y"),
            ] {
                ui.add(Slider::new(var, -100i32..=100).text(text));
            }
        });
        ui.collapsing("BW Dialogs", |ui| {
            self.dialog_debug_ui(bw, ui);
        });
        // The chat log normally opens because SC:R's own chat history dialog spawned and was
        // replaced, which needs that dialog's runtime name (see
        // `overlay_ui::shell::native_dialogs`). Until it is captured, this is the only way to put
        // the screen in front of a real game's chat.
        if ui.button("Open chat history").clicked() {
            self.shell.open_modal(ModalId::ChatHistory);
        }
        ui.collapsing("Pre-SC:R graphic layers", |ui| {
            ui.label("Click to show / hide");
            if let Some(layers) = bw.graphic_layers {
                for i in 0..8 {
                    unsafe {
                        let layer = layers.as_ptr().add(i as usize);
                        let has_draw_func = (*layer).draw_func.is_some();
                        let was_hidden = (*layer).draw == 0;
                        let mut hidden = was_hidden;
                        let mut name = format!("Layer {i}");
                        if !has_draw_func {
                            name.push_str(" (No draw func set)");
                        }
                        ui.toggle_value(&mut hidden, name);
                        if hidden != was_hidden && has_draw_func {
                            self.out_state.show_hide_graphic_layer = Some((i, !hidden));
                        }
                    }
                }
            }
        });
        ui.add(Slider::new(&mut self.draw_layer, 0u16..=0x1f).text("Draw layer"));
        let msg = format!(
            "Windows mouse {}, {},\n    egui {}, {}",
            self.last_mouse_pos.0.0,
            self.last_mouse_pos.0.1,
            self.last_mouse_pos.1.x,
            self.last_mouse_pos.1.y,
        );
        ui.label(egui::RichText::new(msg).size(18.0));
        let msg = format!(
            "Windows size {}, {}, egui size {}, {}",
            self.window_size.0, self.window_size.1, self.screen_size.0, self.screen_size.1,
        );
        ui.label(egui::RichText::new(msg).size(18.0));
        let modifiers = current_egui_modifiers();
        let msg = format!(
            "Ctrl {}, Alt {}, shift {}",
            modifiers.ctrl, modifiers.alt, modifiers.shift,
        );
        ui.label(egui::RichText::new(msg).size(18.0));
    }

    fn dialog_debug_ui(&mut self, bw: &BwVars, ui: &mut egui::Ui) {
        if !self.dialog_debug_inspect_children {
            ui.label("Click to show / hide (Hidden dialogs stay interactable)");
        }
        ui.checkbox(&mut self.dialog_debug_inspect_children, "Inspect children");
        for dialog in bw::iter_dialogs(bw.first_dialog) {
            let ctrl = dialog.as_control();
            let name = ctrl.string();
            // (Coordinates are based on 4:3 => 640x480)
            let rect = ctrl.screen_coords();
            let name = format!(
                "{} {},{},{},{}",
                name, rect.left, rect.top, rect.right, rect.bottom
            );
            if !self.dialog_debug_inspect_children {
                let mut hidden = ctrl.is_hidden();
                ui.toggle_value(&mut hidden, name);
                if hidden != ctrl.is_hidden() {
                    self.out_state.show_hide_control = Some((ctrl, !hidden));
                }
            } else {
                // Pointer address as id_source is stable for lifetime
                // of the dialog. Maybe will have small issues with ones that
                // get deleted and readded sometimes using same address?
                egui::CollapsingHeader::new(name)
                    .id_salt(*dialog as usize)
                    .show(ui, |ui| {
                        for ctrl in dialog.children() {
                            let rect = ctrl.dialog_coords();
                            let name = format!(
                                "{} {}: '{}' {},{},{},{}",
                                control_type_name(ctrl.control_type()),
                                ctrl.id(),
                                ctrl.string(),
                                rect.left,
                                rect.top,
                                rect.right,
                                rect.bottom,
                            );
                            let mut hidden = ctrl.is_hidden();
                            ui.toggle_value(&mut hidden, name);
                            if hidden != ctrl.is_hidden() {
                                self.out_state.show_hide_control = Some((ctrl, !hidden));
                            }
                        }
                    });
            }
        }
    }

    /// Keeps what the observer panels report in step with the game: whose vision the watcher has,
    /// and what every player is making. The panels themselves are drawn by the shell.
    fn update_replay_state(&mut self, bw: &BwVars) {
        let frame = bw.game.frame_count();
        if frame == 0 {
            // Explicit init at start of the game to handle replay restarts /
            // if we eventually support keeping client over multiple games.
            self.replay_start_handled = false;
        }
        if frame >= 1 && !self.replay_start_handled {
            // Replay start;
            // Disable vision for any players that don't own units (Assuming they're observers)
            self.replay_start_handled = true;
            self.player_vision_was_auto_disabled = [false; 8];
            for i in 0..8 {
                if !player_has_units(bw, i) && !bw.is_team_game {
                    let mask = 1 << i;
                    self.out_state.replay_visions &= !mask;
                    self.player_vision_was_auto_disabled[i as usize] = true;
                }
            }
        } else if self.replay_start_handled {
            // If we had disabled the vision but a player has suddenly gained units,
            // enable the vision.
            for i in 0..8 {
                if self.player_vision_was_auto_disabled[i as usize] && player_has_units(bw, i) {
                    let mask = 1 << i;
                    self.out_state.replay_visions |= mask;
                    self.player_vision_was_auto_disabled[i as usize] = false;
                }
            }
        }
        self.update_replay_production(bw);
    }

    /// Carries out one thing the shell asked of the game, or hands on the ones only the caller can
    /// do.
    ///
    /// The transport's commands go into `replay_commands` rather than being sent here: submitting a
    /// game command needs the `BwScr` this draw path was called from, which the overlay deliberately
    /// knows nothing about.
    fn execute_intent(
        &mut self,
        bw: &BwVars,
        intent: Intent,
        replay_commands: &mut Vec<ReplayCommand>,
    ) {
        match intent {
            // Safe to reach the turn state here: the draw path holds no turn-state lock across
            // `step`.
            Intent::DropPlayer { slot } => {
                netcode_v2::with_turn_state(|s| s.request_drop(SlotId(slot)));
            }
            Intent::CloseNativeDialog(dialog) => {
                dialog_hook::close_replaced_dialog(bw.first_dialog, dialog);
            }
            Intent::Seek(frame) => replay_commands.push(ReplayCommand::Seek { frame }),
            Intent::SetSpeed {
                speed_index,
                multiplier,
                paused,
            } => replay_commands.push(ReplayCommand::Speed {
                speed_index,
                multiplier,
                paused,
            }),
            Intent::ToggleVision { player_id } => self.toggle_player_vision(bw, player_id),
            Intent::SelectProduction { player_id, item } => {
                self.select_production(player_id, item as usize)
            }
            // Leaving the game is not something the overlay can ask of BW yet, so the request is
            // recorded and nothing else happens: the player stays in a game they asked to leave,
            // which is the honest behaviour until the host side of it exists.
            Intent::AbandonGame => info!("Overlay: abandon requested"),
        }
    }

    /// The players of this game as the disconnect surface names them: everyone in a playing slot,
    /// with the color they are on the map and whether they are on the local player's side.
    ///
    /// Built only for the frames the surface is actually up, because it reads eight slots out of
    /// BW's own tables and clones a name for each of them.
    fn disconnect_roster(
        &self,
        bw: &BwVars,
        status: &DisconnectStatus,
        now: Instant,
    ) -> Vec<disconnect::RosterPlayer> {
        if status.rows(now).is_empty() && status.self_state(now) == netcode_v2::SelfState::Healthy {
            return Vec::new();
        }
        let teams = player_teams(bw);
        let local = bw.local_player_id;
        (0..8u8)
            .filter(|&player_id| is_human_player(bw, player_id as usize))
            .map(|player_id| disconnect::RosterPlayer {
                name: stats::player_name(bw, player_id),
                color: stats::player_color(bw, player_id),
                // A side rather than a declared alliance: `player_teams` is the game's own team
                // numbers where the game type has them and who has mutually allied whom where it
                // does not, which is the only record a melee two-versus-two keeps of itself.
                teammate: player_id != local
                    && usize::from(local) < teams.len()
                    && teams[usize::from(player_id)] == teams[usize::from(local)],
                is_local: player_id == local,
            })
            .collect()
    }

    /// Shows or stops showing the game through a player's eyes.
    ///
    /// The whole group that shares vision with them moves together: half of a shared pair would be a
    /// map neither player sees. Writing the replay visions is enough — BW keeps per-player vision
    /// and exploration of its own, but a replay ignores both.
    fn toggle_player_vision(&mut self, bw: &BwVars, player_id: u8) {
        if player_id >= 8 {
            return;
        }
        let bit = 1u8 << player_id;
        let mask = unsafe { team_vision_mask(bw, player_id) };
        if bw.replay_visions & bit != 0 {
            self.out_state.replay_visions &= !mask;
        } else {
            self.out_state.replay_visions |= mask;
        }
        // Asking for a player's vision by hand outranks the guess made at the replay's start that
        // they were an observer, so the guess is not made about them again.
        if let Some(auto_disabled) = self
            .player_vision_was_auto_disabled
            .get_mut(player_id as usize)
        {
            *auto_disabled = false;
        }
    }

    /// Builds the matchup bar's view: every player the replay is worth showing, in team order.
    fn build_matchup_view(&self, bw: &BwVars, apm: Option<&ApmStats>) -> MatchupView {
        let players = replay_players_by_team(bw)
            .filter(|&(_team, player_id)| {
                // Players with no units are taken for observers on a UMS map, which have no numbers
                // worth a half of the bar. A team game's players are all shown, since one of them
                // owns the team's units. And a player whose vision the watcher has taken is shown
                // whatever they own, so it is clear where the vision on screen is coming from.
                player_has_units(bw, player_id)
                    || bw.is_team_game
                    || has_player_vision(bw, player_id)
            })
            .map(|(team, player_id)| unsafe {
                let player = bw.players.add(player_id as usize);
                matchup_player_view(bw, player, player_id, team, apm)
            })
            .collect();
        MatchupView {
            players,
            elapsed_secs: transport::frames_to_seconds(
                bw.game.frame_count(),
                bw.replay
                    .map_or(FASTEST_GAME_SPEED, |replay| replay.game_speed),
            ),
            is_replay: bw.is_replay,
        }
    }

    /// Makes an area the overlay drew interactable by the player, whether or not one of BW's own
    /// menus is on top: the only caller left is the debug window, which is a developer's and not a
    /// surface the game is allowed to take clicks from. Every other rect the frame owns comes from
    /// the shell.
    fn force_add_ui_rect<T>(
        &mut self,
        response: &Option<egui::InnerResponse<T>>,
        capture_mouse_scroll: bool,
    ) {
        if let Some(res) = response {
            self.ui_rects.push(UiRect {
                area: res.response.rect,
                capture_mouse_scroll,
            });
        }
    }

    /// Returns cursor type if cursor is on the overlays.
    /// Specifically prevents the cursor from changing due to units being behind the overlay.
    /// Only thing we do return for now is 0 for regular mouse pointer.
    pub fn decide_cursor_type(&self) -> Option<BwCursorType> {
        if self.mouse_down != [false, false] && self.captured_mouse_down == [false, false] {
            // Mouse is down but not captured by us, don't modify cursor even
            // if it would be on top of overlay.
            // (Not really sure how the conditional should be with the two separate mouse buttons)
            return None;
        }
        // Otherwise if the cursor is on the overlays, return regular arrow.
        let mouse_on_ui = self
            .ui_rects
            .iter()
            .any(|rect| rect.area.contains(self.last_mouse_pos.1));
        if mouse_on_ui {
            return Some(BwCursorType::Arrow);
        }
        None
    }

    /// If this returns Some(), the message won't be passed to BW
    pub unsafe fn window_proc(
        &mut self,
        window: HWND,
        msg: u32,
        wparam: usize,
        lparam: isize,
    ) -> Option<isize> {
        unsafe {
            use winapi::um::winuser::*;
            match msg {
                WM_SIZE => {
                    let w = lparam as i16;
                    let h = (lparam >> 16) as i16;
                    if let (Ok(w), Ok(h)) = (w.try_into(), h.try_into()) {
                        // If something causes the window size be 0, it's probably better
                        // to ignore it that potentially divide by 0 later on..
                        if w != 0 && h != 0 {
                            self.window_size = (w, h);
                        }
                    }
                    None
                }
                WM_MOUSEMOVE => {
                    let x = lparam as i16;
                    let y = (lparam >> 16) as i16;
                    let pos = self.window_pos_to_egui(x as i32, y as i32);
                    self.last_mouse_pos = ((x, y), pos);
                    self.events.push(Event::PointerMoved(pos));
                    None
                }
                WM_LBUTTONDOWN | WM_LBUTTONUP | WM_RBUTTONDOWN | WM_RBUTTONUP => {
                    let (button, button_idx) = match msg {
                        WM_LBUTTONUP | WM_LBUTTONDOWN => (PointerButton::Primary, 0),
                        WM_RBUTTONUP | WM_RBUTTONDOWN => (PointerButton::Secondary, 1),
                        _ => return None,
                    };
                    let pressed = matches!(msg, WM_LBUTTONDOWN | WM_RBUTTONDOWN);
                    let x = lparam as i16;
                    let y = (lparam >> 16) as i16;
                    let pos = self.window_pos_to_egui(x as i32, y as i32);
                    let handle = if pressed {
                        self.ui_rects.iter().any(|x| x.area.contains(pos))
                    } else {
                        self.captured_mouse_down[button_idx]
                    };
                    self.mouse_down[button_idx] = pressed;
                    if !handle {
                        return if self.capture.blocks_game_pointer() {
                            Some(0)
                        } else {
                            None
                        };
                    }
                    self.captured_mouse_down[button_idx] = pressed;
                    self.events.push(Event::PointerButton {
                        pos,
                        button,
                        pressed,
                        modifiers: egui::Modifiers {
                            alt: GetKeyState(VK_MENU) & 1 != 0,
                            ctrl: wparam & MK_CONTROL != 0,
                            shift: wparam & MK_SHIFT != 0,
                            mac_cmd: false,
                            command: wparam & MK_CONTROL != 0,
                        },
                    });
                    Some(0)
                }
                WM_MOUSEWHEEL => {
                    let x = lparam as i16;
                    let y = (lparam >> 16) as i16;
                    let mut point = POINT {
                        x: x as i32,
                        y: y as i32,
                    };
                    ScreenToClient(window, &mut point);
                    let pos = self.window_pos_to_egui(point.x, point.y);
                    let handle = self
                        .ui_rects
                        .iter()
                        .any(|x| x.capture_mouse_scroll && x.area.contains(pos));
                    if !handle {
                        return if self.capture.blocks_game_pointer() {
                            Some(0)
                        } else {
                            None
                        };
                    }
                    // Scroll amount seems to be fine without any extra scaling
                    let amount = ((wparam >> 16) as i16) as f32;
                    let modifiers = current_egui_modifiers();
                    self.events.push(Event::MouseWheel {
                        unit: egui::MouseWheelUnit::Point,
                        delta: egui::vec2(0.0, amount),
                        // egui 0.35 added a scroll phase for trackpads; a mouse wheel has no phase,
                        // so use the "unknown" value egui documents for that case.
                        phase: egui::TouchPhase::Move,
                        modifiers,
                    });
                    Some(0)
                }
                WM_KEYDOWN | WM_KEYUP | WM_SYSKEYDOWN | WM_SYSKEYUP => {
                    let mut modifiers = current_egui_modifiers();
                    let is_syskey = matches!(msg, WM_SYSKEYDOWN | WM_SYSKEYUP);
                    let pressed = matches!(msg, WM_KEYDOWN | WM_SYSKEYDOWN);
                    modifiers.alt |= is_syskey;
                    let vkey = wparam as i32;
                    let key = vkey_to_egui_key(vkey);
                    if let Some(key) = key {
                        if !is_syskey && self.ctx.egui_wants_keyboard_input() {
                            self.events.push(Event::Key {
                                key,
                                // Probably fine to leave None, could also be Some(key) even
                                // if it is not what it's supposed to mean. Properly figuring
                                // out the physical key would be too much work.
                                physical_key: None,
                                pressed,
                                // Could get repeat count from param, but egui docs say that
                                // it will be automatically done anyway by egui.
                                repeat: false,
                                modifiers,
                            });
                            return Some(0);
                        }
                        // Nothing focused wanted the key, so the shell gets its turn at it before
                        // the game does. It takes only what it can act on.
                        if pressed && self.shell.key_pressed(key, modifiers) {
                            return Some(0);
                        }
                    }
                    if self.capture.blocks_game_key(key) {
                        return Some(0);
                    }
                    None
                }
                WM_CHAR => {
                    if !self.ctx.egui_wants_keyboard_input() {
                        // Characters are never swallowed by the shell's input capture; see
                        // `InputCapture`'s doc comment for why the chat box depends on that.
                        return None;
                    }
                    if wparam >= 0x80 {
                        // Too lazy to figure out how windows sends
                        // unicode chars to SC:R window, and we shouldn't need
                        // egui to support actual text input outside some
                        // debug stuff
                        return Some(0);
                    }
                    if let Some(c) = char::from_u32(wparam as u32) {
                        self.events.push(Event::Text(c.into()));
                    }
                    Some(0)
                }
                _ => None,
            }
        }
    }

    fn window_pos_to_egui(&self, x: i32, y: i32) -> Pos2 {
        // If the draw surface is 4:3, but window is 16:9, assumes
        // that the draw surface be centered on the window.
        // (In that case screen_window_ratio will be 0.75)
        // BW shouldn't let the window be resized so that black bars are added to top/bottom
        // instead of left/right, but supporting that for completeness..
        //
        // Also idk if this should just ask BW where the draw surface is placed on
        // window instead of assuming centered.
        let window_w = self.window_size.0 as f32;
        let window_h = self.window_size.1 as f32;
        let screen_w = self.screen_size.0 as f32;
        let screen_h = self.screen_size.1 as f32;

        let screen_window_ratio = (screen_w / screen_h) / (window_w / window_h);
        if (screen_window_ratio - 1.0).abs() < 0.001 {
            Pos2 {
                x: x as f32 / window_w * screen_w,
                y: y as f32 / window_h * screen_h,
            }
        } else if screen_window_ratio < 1.0 {
            let x_offset = window_w * (1.0 - screen_window_ratio) * 0.5;
            let x_div = window_w * screen_window_ratio;
            Pos2 {
                x: (x as f32 - x_offset) / x_div * screen_w,
                y: y as f32 / window_h * screen_h,
            }
        } else {
            let ratio = screen_window_ratio.recip();
            let y_offset = window_h * (1.0 - ratio) * 0.5;
            let y_div = window_h * ratio;
            Pos2 {
                x: x as f32 / window_w * screen_w,
                y: (y as f32 - y_offset) / y_div * screen_h,
            }
        }
    }
}

/// Yields active players `(team, player_id)`, ordered by team and then by slot.
///
/// Every observer surface reads its players from here, which is what keeps a row in one panel
/// lined up with the row for the same player in the next and lets the ones that group by side do
/// it by walking a list rather than by grouping it again.
fn replay_players_by_team(bw: &BwVars) -> impl Iterator<Item = (u8, u8)> + use<> {
    let teams = player_teams(bw);
    let mut ordered: Vec<(u8, u8)> = (0u8..8)
        .filter(|&player_id| is_active_player(bw, player_id as usize))
        .map(|player_id| (teams[player_id as usize], player_id))
        .collect();
    ordered.sort_unstable();
    ordered.into_iter()
}

/// Whether this slot is one the game is being played from, as opposed to an empty one or an
/// observer.
fn is_active_player(bw: &BwVars, player_id: usize) -> bool {
    unsafe { matches!((*bw.players.add(player_id)).player_type, 1 | 2) }
}

/// Whether this slot is a person rather than a computer or an empty one. The narrower of the two
/// tests: a computer never loses a connection, so it is never one of the players a game is waiting
/// on.
fn is_human_player(bw: &BwVars, player_id: usize) -> bool {
    unsafe { (*bw.players.add(player_id)).player_type == 2 }
}

/// Which side each of the game's eight slots is on.
///
/// The game's own team numbers when the game type has them. A melee map has none — every slot's
/// team stays zero however the players lined up — so those games are grouped by who has allied
/// whom instead, which is the only record of a two-versus-two played on a melee map that the
/// simulation actually keeps.
fn player_teams(bw: &BwVars) -> [u8; 8] {
    let mut teams = [0u8; 8];
    let mut any_team = false;
    for (player_id, team) in teams.iter_mut().enumerate() {
        if !is_active_player(bw, player_id) {
            continue;
        }
        *team = unsafe { (*bw.players.add(player_id)).team };
        any_team |= *team != 0;
    }
    if any_team {
        return teams;
    }
    alliance_teams(bw)
}

/// Groups the active slots by who they are mutually allied with, numbering the groups in slot
/// order so a side is called after where it sits rather than after an empty slot beside it.
///
/// A one-way alliance is not a side: a player who has allied someone who has not allied them back
/// is fighting alone, whatever they have declared.
fn alliance_teams(bw: &BwVars) -> [u8; 8] {
    let mut teams = [0u8; 8];
    let mut next = 1u8;
    for player_id in 0..8 {
        if teams[player_id] != 0 || !is_active_player(bw, player_id) {
            continue;
        }
        let group = next;
        next += 1;
        for (other, team) in teams.iter_mut().enumerate().skip(player_id) {
            if *team != 0 || !is_active_player(bw, other) {
                continue;
            }
            if other == player_id || mutually_allied(bw, player_id, other) {
                *team = group;
            }
        }
    }
    teams
}

/// Whether two slots have each declared the other an ally.
fn mutually_allied(bw: &BwVars, a: usize, b: usize) -> bool {
    unsafe {
        let alliances = &(**bw.game).alliances;
        alliances[a][b] != 0 && alliances[b][a] != 0
    }
}

fn player_has_units(bw: &BwVars, player_id: u8) -> bool {
    unsafe { !(*bw.first_player_unit.add(player_id as usize)).is_null() }
}

fn has_player_vision(bw: &BwVars, player_id: u8) -> bool {
    match 1u8.checked_shl(player_id as u32) {
        Some(bit) => bw.replay_visions & bit != 0,
        None => true,
    }
}

/// The game speed a live game is played at, which is what turns its frame count into the clock the
/// matchup bar shows. A replay carries its own recorded speed instead.
pub const FASTEST_GAME_SPEED: u8 = 6;

/// Reads one player's half of the matchup bar off the game.
unsafe fn matchup_player_view(
    bw: &BwVars,
    player: *mut bw::Player,
    player_id: u8,
    team: u8,
    apm: Option<&ApmStats>,
) -> MatchupPlayerView {
    unsafe {
        let game = bw.game;
        let race = match (*player).race {
            0 => (Race::Zerg, RaceView::Zerg),
            1 => (Race::Terran, RaceView::Terran),
            2 => (Race::Protoss, RaceView::Protoss),
            // A random player's race is resolved before the game starts, so anything else here is a
            // slot whose race the game itself does not know.
            _ => (Race::Zerg, RaceView::Random),
        };
        // Supply is counted internally at twice what the game shows, because a zergling costs half
        // of one, so what is used rounds up and what is available divides evenly.
        let supply_used = game.supply_used(player_id, race.0).wrapping_add(1) / 2;
        let supply_max = game
            .supply_provided(player_id, race.0)
            .min(game.supply_max(player_id, race.0))
            / 2;
        let color = bw::player_color(
            game,
            bw.main_palette,
            bw.use_rgb_colors,
            bw.rgb_colors,
            player_id,
        );
        let mut name = bw::player_name(player);
        if name.is_empty() {
            name = format!("Player {}", player_id + 1).into();
        }
        MatchupPlayerView {
            player_id,
            team,
            name: name.into_owned(),
            color: Color32::from_rgb(color[0], color[1], color[2]),
            race: race.1,
            vision: has_player_vision(bw, player_id),
            minerals: game.minerals(player_id),
            gas: game.gas(player_id),
            supply_used,
            supply_max,
            apm: apm
                .map(|stats| stats.player_recent_apm(player_id))
                .unwrap_or(0),
        }
    }
}

/// Returns mask containing all player bits that this player has given/receives vision to,
/// as long as all players in the group share vision both ways.
/// If there is one-way vision somewhere, returns just `1 << player_id`
///
/// So that entire team's vision is toggled at once.
unsafe fn team_vision_mask(bw: &BwVars, player_id: u8) -> u8 {
    unsafe {
        if player_id >= 8 {
            return 0;
        }
        let default_value = 1u8 << player_id;
        let mask = (**bw.game).visions[player_id as usize] as u8;
        for i in 0..8 {
            if mask & (1 << i) != 0 && (**bw.game).visions[i] != mask as u32 {
                return default_value;
            }
        }
        mask
    }
}

fn control_type_name(ty: u16) -> Cow<'static, str> {
    match ty {
        0x0 => "Dialog",
        0x1 => "Default button",
        0x2 => "Button",
        0x3 => "Option",
        0x4 => "Checkbox",
        0x5 => "Image",
        0x6 => "Slider",
        0x7 => "Scroll bar",
        0x8 => "Textbox",
        0x9 => "Label (Left)",
        0xa => "Label (Center)",
        0xb => "Label (Right)",
        0xc => "Listbox",
        0xd => "Dropdown",
        0xe => "Video",
        0xf => "Webui",
        _ => return format!("Type_{ty:02x}").into(),
    }
    .into()
}

fn current_egui_modifiers() -> egui::Modifiers {
    use winapi::um::winuser::*;

    unsafe {
        let alt_down = GetKeyState(VK_MENU) as u16 & 0x8000 != 0;
        let ctrl_down = GetKeyState(VK_CONTROL) as u16 & 0x8000 != 0;
        let shift_down = GetKeyState(VK_SHIFT) as u16 & 0x8000 != 0;
        egui::Modifiers {
            alt: alt_down,
            ctrl: ctrl_down,
            shift: shift_down,
            mac_cmd: false,
            command: ctrl_down,
        }
    }
}

fn vkey_to_egui_key(key: i32) -> Option<Key> {
    use egui::Key::*;
    use winapi::um::winuser::*;

    Some(match key {
        VK_DOWN => ArrowDown,
        VK_LEFT => ArrowLeft,
        VK_RIGHT => ArrowRight,
        VK_UP => ArrowUp,
        VK_ESCAPE => Escape,
        VK_TAB => Tab,
        VK_BACK => Backspace,
        VK_RETURN => Enter,
        VK_SPACE => Space,
        VK_INSERT => Insert,
        VK_DELETE => Delete,
        VK_HOME => Home,
        VK_END => End,
        VK_PRIOR => PageUp,
        VK_NEXT => PageDown,
        VK_SUBTRACT => Minus,
        VK_ADD => Plus,
        0x30 | VK_NUMPAD0 => Num0,
        0x31 | VK_NUMPAD1 => Num1,
        0x32 | VK_NUMPAD2 => Num2,
        0x33 | VK_NUMPAD3 => Num3,
        0x34 | VK_NUMPAD4 => Num4,
        0x35 | VK_NUMPAD5 => Num5,
        0x36 | VK_NUMPAD6 => Num6,
        0x37 | VK_NUMPAD7 => Num7,
        0x38 | VK_NUMPAD8 => Num8,
        0x39 | VK_NUMPAD9 => Num9,
        0x41 => A,
        0x42 => B,
        0x43 => C,
        0x44 => D,
        0x45 => E,
        0x46 => F,
        0x47 => G,
        0x48 => H,
        0x49 => I,
        0x4a => J,
        0x4b => K,
        0x4c => L,
        0x4d => M,
        0x4e => N,
        0x4f => O,
        0x50 => P,
        0x51 => Q,
        0x52 => R,
        0x53 => S,
        0x54 => T,
        0x55 => U,
        0x56 => V,
        0x57 => W,
        0x58 => X,
        0x59 => Y,
        0x5a => Z,
        VK_F1 => F1,
        VK_F2 => F2,
        VK_F3 => F3,
        VK_F4 => F4,
        VK_F5 => F5,
        VK_F6 => F6,
        VK_F7 => F7,
        VK_F8 => F8,
        VK_F9 => F9,
        VK_F10 => F10,
        VK_F11 => F11,
        VK_F12 => F12,
        VK_F13 => F13,
        VK_F14 => F14,
        VK_F15 => F15,
        VK_F16 => F16,
        VK_F17 => F17,
        VK_F18 => F18,
        VK_F19 => F19,
        VK_F20 => F20,
        _ => return None,
    })
}
