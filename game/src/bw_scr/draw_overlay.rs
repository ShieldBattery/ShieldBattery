use std::borrow::Cow;
use std::mem;
use std::path::Path;
use std::ptr::NonNull;
use std::sync::Arc;
use std::time::{Duration, Instant};

use bw_dat::Unit;
use bw_dat::dialog::{Control, Dialog};
use egui::{Color32, Event, Key, PointerButton, Pos2, Rect, Slider, pos2};
use overlay_ui::end_card::EndCardView;
use overlay_ui::net_quality::NetQualityView;
use overlay_ui::observer::{MatchupPlayerView, MatchupView};
use overlay_ui::options::{OptionsLists, OptionsView, SettingChange};
use overlay_ui::shell::{
    DisconnectSurface, FrameOutput, HostFrame, InputCapture, Intent, ModalId, Mode, NativeDialog,
    PanelPrefs, PauseControl, Shell, Views, hotkeys,
};
use overlay_ui::transport::{self, TransportView};
use parking_lot::Mutex;
use rally_point_client::proto::ids::SlotId;
use winapi::shared::windef::{HWND, POINT};

use crate::app_messages::GameSetupInfo;
use crate::bw;
use crate::bw::apm_stats::ApmStats;
use crate::bw_scr::chat::ChatManager;
use crate::bw_scr::game_stats::{self, GameStats};
use crate::bw_scr::replay_transport::{ReplayCommand, TransportState};
use crate::bw_scr::scr;
use crate::bw_scr::stat_txt::StatTxt;
use crate::bw_scr::{BwCursorType, console, dialog_hook};
use crate::netcode_v2::{self, DisconnectStatus, LoadingConnectivity, NetStatsStatus};

pub use self::alliances::AllianceRules;
use self::alliances::AlliancesState;
use self::chat_history::ChatHistoryCache;
use self::production::ProductionState;
use self::stats::ObserverViewCache;

// The overlay's fonts, colours, and disconnect presentation live in the host-compilable `overlay-ui`
// crate; re-exported here so the DLL's other overlays keep referring to them by the same paths.
pub use overlay_ui::{colors, fonts};

mod alliances;
mod chat_history;
mod disconnect;
mod end_card;
mod loading_screen;
mod netstat;
pub mod options;
mod production;
mod resource_icons;
mod stats;
mod wireframe;

pub use self::wireframe::WireframeRemap;

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
    /// The minimap dialog's rect, in BW's dialog coordinates, as last logged.
    logged_minimap_area: Option<(i16, i16, i16, i16)>,
    /// The chat log the last frame handed the shell, kept only while its modal is on screen.
    chat_history: Option<ChatHistoryCache>,
    /// The observer panels the last frame handed the shell, kept while the client is watching.
    observer_view: Option<ObserverViewCache>,
    /// What the alliances screen keeps between frames.
    alliances: AlliancesState,
    /// The game's own resource icons, once read.
    resource_icons: Option<resource_icons::LoadedResourceIcons>,
    /// How much of the screen's height the band the minimap stands in takes, from the screen's
    /// bottom edge to the minimap's top, as last seen. Kept while the minimap is hidden: the other
    /// bottom panels still stand in that band.
    bottom_band_share: f32,
    /// What the end-of-game card reports, read once as the card comes up and kept while it is on
    /// the stack: it is about the game as it was decided, and the numbers behind it keep moving for
    /// as long as the player keeps playing.
    end_card: Option<EndCardView>,
    out_state: OutState,
    window_size: (u32, u32),
    /// If (and only if) a mouse button down event was captured,
    /// capture the up event as well.
    captured_mouse_down: [bool; 2],
    /// Per mouse button, whether the last press was delivered to BW (neither captured by the
    /// overlay nor swallowed by the disconnect block), so its release is delivered too. BW must
    /// see every release of a press it saw — otherwise it is left mid-drag-select with no way to
    /// finish — and must never see a release without its press, which can shift BW's dialog focus
    /// (off an open chat box, for one). Indexed like [`mouse_down`](Self::mouse_down).
    bw_mouse_down: [bool; 2],
    /// Keep track if mouse button is down even when it wasn't started on
    /// top of overlay rects.
    mouse_down: [bool; 2],
    /// Size told to egui. Currently render target size which seems to
    /// be always for 1080x1920 window (Width depends on SD/HD though)
    screen_size: (u32, u32),
    /// Winapi coords, egui coords
    last_mouse_pos: ((i16, i16), Pos2),
    /// Whether SC:R's mouse scaling is on, which changes where a window position is in the game.
    mouse_scaling: bool,
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
    /// The observer panels as last saved, so a change is saved once rather than every frame.
    saved_observer_panels: Option<PanelPrefs>,
    /// The frame the overlay last asked a replay to seek to, which a look at a place belongs to.
    last_requested_seek: Option<u32>,
    /// A place to center the view on once the replay reaches the frame a seek asked for.
    pending_look_at: Option<PendingLookAt>,
    /// The last number-key group recalled, and when, so a second press can center on it.
    last_group_recall: Option<(u8, u8, Instant)>,
    /// The scan codes of the keys held down whose press the shell took. The rest of each keystroke
    /// (its character and its release) is kept from the game too: SC:R acts on some keys from their
    /// character, so a number key recalls the game's own group on top of the one the shell
    /// selected unless the character is swallowed with the press.
    shell_held_keys: Vec<u16>,
}

/// Which physical key a key or character message is about, extended keys apart from the rest.
fn message_scan_code(lparam: isize) -> u16 {
    ((lparam >> 16) & 0x1ff) as u16
}

/// A look at a place that waits for a seek to land: centered before it, the view would be moved
/// for a game the seek is about to replace.
struct PendingLookAt {
    frame: u32,
    point: overlay_ui::observer::MapPoint,
    asked: Instant,
}

/// How far past a seek's frame the replay may already be when the look waiting on it is let out:
/// a seek lands on its frame and the game runs on, and the draw that sees it may come a few frames
/// later.
const LOOK_AT_WINDOW_FRAMES: u32 = 72;

/// How long a look waits for its seek to land before it is given up, for a seek the game refused or
/// one another seek replaced.
const LOOK_AT_TIMEOUT: Duration = Duration::from_secs(5);

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
    leave_game: bool,
    look_at: Option<bw::Point>,
    select_group: Option<GroupSelection>,
    clear_selection: bool,
    follow_unit: Option<Unit>,
}

/// One of a player's number-key groups, selected for the watcher.
pub struct GroupSelection {
    /// The group's living units, in the group's order.
    pub units: Vec<Unit>,
    /// Whether the view is to be centered on them too: the key was pressed twice in a row, which is
    /// what centers a group in the game.
    pub center: bool,
}

/// How soon a second press of a number key must follow the first to center the view on its group.
const GROUP_DOUBLE_PRESS: Duration = Duration::from_millis(500);

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
    /// Game commands the player issued from the overlay this frame, in the order they issued them,
    /// for the game to send as though its own UI had.
    pub game_commands: Vec<Vec<u8>>,
    /// Settings the player moved on the options screen this frame, in the order they moved them,
    /// for the game to apply and the app to save.
    pub setting_changes: Vec<SettingChange>,
    /// The observer panels, when the watcher has changed which are on screen since they were last
    /// saved.
    pub observer_panels_changed: Option<PanelPrefs>,
    // true to run second draw to avoid ugly flickering due to screen size changing.
    pub run_second_draw: bool,
    /// Whether the player asked to leave the game, the way the in-game menu's End Game does.
    pub leave_game: bool,
    /// A place on the map to center the game's view on.
    pub look_at: Option<bw::Point>,
    /// A number-key group to select.
    pub select_group: Option<GroupSelection>,
    /// Whether to select nothing at all.
    pub clear_selection: bool,
    /// A unit for the game's view to follow from now on.
    pub follow_unit: Option<Unit>,
    /// How much of the view's height it may scroll past the map's bottom edge: the band the
    /// overlay's bottom panels cover for a watcher, nothing for a player.
    pub bottom_overpan_share: f32,
}

/// Where a window position is on the overlay's screen of `screen` points while SC:R's mouse scaling
/// is on, for a window `window` client pixels in size.
///
/// With scaling on, the game keeps the OS cursor inside a box in the middle of the window, one
/// window pixel to one game pixel (the game's 480 rows and its width in game pixels across them),
/// and reads a position as how far into that box it is. The cursor it draws is that game pixel
/// stretched over the whole shown area, which is where the pointer has to be for the overlay too.
fn scaled_mouse_pos_to_egui(
    (x, y): (i32, i32),
    (window_w, window_h): (f32, f32),
    (screen_w, screen_h): (f32, f32),
) -> Pos2 {
    const GAME_HEIGHT: f32 = 480.0;
    let game_w = (GAME_HEIGHT * screen_w / screen_h.max(1.0))
        .round()
        .max(1.0);
    // Halved the way the game halves it, in whole pixels rounded towards zero.
    let origin_x = ((window_w - game_w) / 2.0).trunc();
    let origin_y = ((window_h - GAME_HEIGHT) / 2.0).trunc();
    let game_x = (x as f32 - origin_x).clamp(0.0, game_w - 1.0);
    let game_y = (y as f32 - origin_y).clamp(0.0, GAME_HEIGHT - 1.0);
    Pos2 {
        x: game_x / game_w * screen_w,
        y: game_y / GAME_HEIGHT * screen_h,
    }
}

/// Bw globals used by OverlayState::step
pub struct BwVars {
    pub is_replay_or_obs: bool,
    pub is_replay: bool,
    pub is_team_game: bool,
    pub game: bw_dat::Game,
    pub players: *mut bw::Player,
    pub main_palette: *mut u8,
    pub rgb_colors: *mut bw::RgbColors,
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
    /// Whether the carbot skin set is the one being drawn, which picks the command-icon frames
    /// the renderer shows along with `is_hd`.
    pub is_carbot: bool,
    /// The game's command-icon atlas, read for the pixel size of the frame an icon will be drawn
    /// with. Valid for as long as the game is running.
    pub cmdicons: *mut scr::DdsGrpSet,
    /// The game's unit wireframes, read for the pixel size of the frame a wireframe will be drawn
    /// with. Valid for as long as the game is running; null where the analysis could not find them,
    /// which leaves every unit on its command icon.
    pub wirefram: *mut scr::DdsGrpSet,
    /// The remap the wireframes' layers are colored through. `None` where the game had none to
    /// read, which leaves every unit on its command icon too.
    pub wireframe_remap: Option<WireframeRemap>,
    pub has_init_bw: bool,
    pub countdown_start: Option<Instant>,
    pub game_started: bool,
    /// The `players[]` index the local client is playing from, which is what decides whose side a
    /// player is on and whose row the disconnect surface leaves out.
    pub local_player_id: u8,
    /// The replay's own header numbers, and how playback is running, for the transport plate.
    /// `None` outside a replay, which is every mode the plate is not drawn in.
    pub replay: Option<ReplayVars>,
    /// Where the game's names for units, upgrades and techs are read from. `None` when the analysis
    /// could not find it, which leaves the panels to go without names.
    pub stat_txt: Option<StatTxt>,
    /// What the game's rules allow of alliances and chat recipients.
    pub alliance_rules: AllianceRules,
    /// What the game offers the local player for pausing.
    pub pause_control: Option<PauseControl>,
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
    Wireframe(u16),
}

// No real reason to start with 0x2000_0000, but since egui gives u64 range,
// might as well not start from 0.
const TEXTURE_FIRST_STATRES: u64 = 0x2000_0000;
const TEXTURE_LAST_STATRES: u64 = TEXTURE_FIRST_STATRES + 0xffff;
const TEXTURE_FIRST_CMDICON: u64 = TEXTURE_LAST_STATRES + 1;
const TEXTURE_LAST_CMDICON: u64 = TEXTURE_FIRST_CMDICON + 0xffff;
const TEXTURE_FIRST_WIREFRAME: u64 = TEXTURE_LAST_CMDICON + 1;
const TEXTURE_LAST_WIREFRAME: u64 = TEXTURE_FIRST_WIREFRAME + 0xffff;

impl Texture {
    pub fn to_egui_id(self) -> u64 {
        match self {
            Texture::StatRes(frame) => TEXTURE_FIRST_STATRES + frame as u64,
            Texture::CmdIcon(frame) => TEXTURE_FIRST_CMDICON + frame as u64,
            Texture::Wireframe(frame) => TEXTURE_FIRST_WIREFRAME + frame as u64,
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
            TEXTURE_FIRST_WIREFRAME..=TEXTURE_LAST_WIREFRAME => {
                Texture::Wireframe((val - TEXTURE_FIRST_WIREFRAME) as u16)
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

/// The draw layer the overlay is drawn at.
///
/// Above every layer SC:R draws, including the final pass that scales its UI render target onto the
/// backbuffer (layers 0x6001 and 0x6002), so the overlay goes straight to the backbuffer and egui
/// rasterizes its text at the window's own resolution rather than at the UI target's, which SD
/// graphics fix at 1280x960 whatever the window. Being on top of all of it also covers what the
/// game draws during loading (the FPS counter and the like).
pub const OVERLAY_DRAW_LAYER: u16 = 0x6100;

/// The draw layer SC:R's software cursor is moved up to, so it is drawn over the overlay.
///
/// The game draws the cursor into its UI render target, at a layer the final pass then scales
/// onto the backbuffer underneath the overlay. Drawn at a layer above the overlay instead, the
/// cursor goes straight to the backbuffer over it. Below 0x8000, which the game's sort reads as
/// negative.
pub const SOFTWARE_CURSOR_DRAW_LAYER: u16 = OVERLAY_DRAW_LAYER + 0x100;

/// The id of the control in BW's minimap dialog that the map itself is drawn in.
const MINIMAP_MAP_CONTROL: i16 = 1;

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
            logged_minimap_area: None,
            end_card: None,
            out_state: OutState {
                replay_visions: 0,
                select_unit: None,
                show_hide_control: None,
                show_hide_graphic_layer: None,
                leave_game: false,
                look_at: None,
                select_group: None,
                clear_selection: false,
                follow_unit: None,
            },
            captured_mouse_down: [false; 2],
            bw_mouse_down: [false; 2],
            mouse_down: [false; 2],
            window_size: (100, 100),
            screen_size: (100, 100),
            last_mouse_pos: ((0, 0), Pos2 { x: 0.0, y: 0.0 }),
            mouse_scaling: false,
            replay_ui_values: ReplayUiValues {
                statbtn_dialog_offset: (0, 0),
            },
            player_vision_was_auto_disabled: [false; 8],
            replay_start_handled: false,
            draw_layer: OVERLAY_DRAW_LAYER,
            dialog_debug_inspect_children: false,
            was_loading: false,
            self_link_lost_since: None,
            // What the shell starts on: a watcher who never changes a panel has nothing to save.
            saved_observer_panels: Some(PanelPrefs::default()),
            last_requested_seek: None,
            pending_look_at: None,
            last_group_recall: None,
            shell_held_keys: Vec::new(),
            chat_history: None,
            observer_view: None,
            alliances: AlliancesState::default(),
            resource_icons: None,
            bottom_band_share: 0.0,
        }
    }

    /// Whether the game's resource icons have yet to be read. Read once, whether or not the game
    /// had them.
    /// Tells the player about a setting the game changed on one of its own keys.
    pub fn setting_changed_in_game(&mut self, change: SettingChange) {
        self.shell.setting_changed_in_game(change);
    }

    pub fn needs_resource_icons(&self) -> bool {
        self.resource_icons.is_none()
    }

    /// Reads the game's resource icons through `read` and hands them to the panels.
    pub fn load_resource_icons(&mut self, read: impl FnMut(&std::ffi::CString) -> Option<Vec<u8>>) {
        let loaded = resource_icons::load(&self.ctx, read);
        overlay_ui::kit::widgets::set_resource_icons(&self.ctx, Some(loaded.icons.clone()));
        self.resource_icons = Some(loaded);
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
        net_rollback: Option<&crate::rollback_live::NetStatus>,
        net_quality: Option<&NetQualityView>,
        loading_connectivity: Option<&LoadingConnectivity>,
        chat_history: &Mutex<crate::bw_scr::chat_history::ChatHistory>,
        chat_manager: &Mutex<ChatManager>,
        options: &Mutex<OptionsView>,
        option_lists: &Mutex<Arc<OptionsLists>>,
        observer_panels: &Mutex<Option<PanelPrefs>>,
    ) -> StepOutput {
        self.mouse_scaling = options.lock().mouse_scaling_on;
        if let Some(panels) = observer_panels.lock().take() {
            self.shell.set_panel_prefs(panels);
            self.saved_observer_panels = Some(panels);
        }
        // BW seems to use different render target sizes depending on SD/HD/4k
        // sprites; with 1280x960 for SD, 1920x1080 for lowres HD, and
        // 3840x2160 for 4k HD?
        // Or i'm not actually sure how it decides this; sometimes i'm seeing 1080p
        // render target and other times 1706x960 on HD with 1080p screen?
        // And 3412x1920 when forcing 4k assets..
        //
        // The overlay is at most 1080 points tall, at a higher pixel density on a taller target,
        // and scaled down further on a target narrower than 16:10 (see `pixels_per_point`).
        let pixels_per_point =
            overlay_ui::kit::pixels::pixels_per_point(screen_size.0 as f32, screen_size.1 as f32);
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
        if screen_size_changed {
            debug!(
                "Overlay screen is {}x{} points at {pixels_per_point} pixels per point",
                screen_size.0, screen_size.1
            );
        }
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
            leave_game: false,
            look_at: None,
            select_group: None,
            clear_selection: false,
            follow_unit: None,
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
            // Menus spawn ahead of the always-present "Minimap", so any of them the player can see
            // sits before it. A hidden one is not the player's to operate: the "TimeOut" BW spawns
            // during a stall, or a menu the overlay has replaced with a surface of its own.
            native_menu_open: bw::iter_dialogs(bw.first_dialog)
                .take_while(|dialog| dialog.as_control().string() != "Minimap")
                .any(|dialog| !dialog.as_control().is_hidden()),
            game_seconds: transport::frames_to_seconds(
                bw.game.frame_count(),
                bw.replay
                    .map_or(FASTEST_GAME_SPEED, |replay| replay.game_speed),
            ),
            pause_control: bw.pause_control,
            minimap_rect: self.minimap_rect(bw),
        };
        if let Some(minimap) = host_frame.minimap_rect {
            let screen = self.ctx.viewport_rect();
            if screen.height() > 0.0 {
                self.bottom_band_share = (screen.bottom() - minimap.top()) / screen.height();
            }
        }
        // Keypresses arrive between frames and are decided against this, so it is refreshed even on
        // the frames the shell draws nothing on.
        self.shell.set_host(&host_frame);
        dialog_hook::advance_quit(bw.first_dialog);
        self.sync_native_dialogs(bw.first_dialog);
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
        let net_stats_view =
            net_stats.map(|status| netstat::build_netstat_view(status, net_rollback, users));
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
        // Built only while its modal is up, like the log: it reads the chat settings under their
        // lock, which nothing else in a frame needs.
        let alliances_view = self
            .shell
            .open_modals()
            .any(|modal| modal == ModalId::Alliances)
            .then(|| {
                self.alliances.build_view(
                    bw,
                    bw.alliance_rules,
                    setup_info,
                    chat_manager,
                    Instant::now(),
                )
            });
        let end_card_result = self
            .shell
            .open_modals()
            .find_map(|modal| modal.end_card_result(host_frame.mode));
        self.end_card = match (end_card_result, self.end_card) {
            (Some(result), Some(view)) if view.result == result => Some(view),
            (Some(result), _) => Some(end_card::build_end_card_view(
                bw,
                apm,
                result,
                host_frame.game_seconds,
            )),
            (None, _) => None,
        };
        // A copy for the frame: the render closure below takes `self` mutably, so a view it reads
        // cannot be borrowed out of a field.
        let end_card_view = self.end_card;
        // Read before the views are built rather than while they are drawn: the panels report on
        // the frame that is being drawn, and a production list sampled after it would be one frame
        // behind everything beside it.
        if bw.game_started && bw.is_replay_or_obs {
            self.update_replay_state(bw);
        }
        // Handed over for every frame the client is watching rather than playing, though the panels
        // that report the sampler's history are only built again once it has moved under them, and
        // only while shown (see `ObserverViewCache`). Lives beside the shell for the frame rather
        // than inside `self`, like the chat log.
        let observer_view = (bw.game_started && bw.is_replay_or_obs).then(|| {
            let matchup = self.build_matchup_view(bw, apm);
            let production = self.build_production_view(bw);
            ObserverViewCache::build(
                self.observer_view.take(),
                bw,
                game_stats,
                self.shell.panel_prefs(),
                matchup,
                production,
            )
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
        // A copy for the frame rather than a lock held across the draw: the intents the frame
        // reports back take the lock again to record what the player moved.
        let options_view = *options.lock();
        // Shared rather than copied: the names in it are read every frame and written only when
        // the app's settings arrive.
        let mut option_lists_view = option_lists.lock().clone();
        // Rollback balance only means anything in a game that rolls back, which the session decides
        // after the lists were built, so the lists learn it here.
        let rolls_back = crate::rollback_live::native_sync_off();
        if option_lists_view.rollback_game != rolls_back {
            Arc::make_mut(&mut option_lists_view).rollback_game = rolls_back;
            *option_lists.lock() = option_lists_view.clone();
        }
        let mut views = Views {
            disconnect: (!disconnect_view.is_empty()).then(|| DisconnectSurface {
                view: &disconnect_view,
                blocks_input: disconnect_status.is_blocking(Instant::now()),
            }),
            net_quality,
            net_stats: net_stats_view.as_ref(),
            chat_history: chat_history_view.as_ref().map(ChatHistoryCache::view),
            alliances: alliances_view.as_ref(),
            end_card: end_card_view.as_ref(),
            transport: transport_view.as_ref(),
            observer: observer_view.as_ref().map(ObserverViewCache::view),
            options: Some(&options_view),
            option_lists: Some(&option_lists_view),
        };
        // Left at its default on a frame the shell doesn't draw, which is a frame that takes none
        // of the player's input and asks nothing of the game.
        let mut frame_output = FrameOutput::default();
        // Floating windows and areas attach to the context (`&ctx`); only the loading screen's
        // `CentralPanel` needs the root `Ui` that `run_ui` hands over.
        let mut output = ctx.run_ui(input, |ui| {
            if bw.game_started {
                if self.was_loading {
                    self.was_loading = false;
                    // Free up all the loading screen images since we'll never need them again
                    ctx.forget_all_images();
                }

                // Every surface of ours is the shell's: the observer panels, the replay
                // transport, the disconnect surface, the `/netstat` diagnostic panel and whatever
                // modal owns the screen. Its rects are registered unconditionally: a BW dialog
                // sitting on the stack (the hidden `TimeOut` among them) must never be able to
                // steal a click from a modal of ours.
                self.shell.update_held_keys(letter_key_is_down);
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
                self.was_loading = true;
                self.add_loading_screen_ui(bw, setup_info, loading_connectivity, ui);
            }
        });
        self.chat_history = chat_history_view;
        self.observer_view = observer_view;
        self.capture = frame_output.capture;
        let mut replay_commands = Vec::new();
        let mut setting_changes = Vec::new();
        let mut game_commands = Vec::new();
        for intent in frame_output.intents {
            match intent {
                // The overlay holds what the player moved, so the screen keeps showing it for the
                // rest of the game; making it real is the game's side, which owns the settings.
                Intent::ChangeSetting(change) => {
                    options.lock().apply(change);
                    setting_changes.push(change);
                }
                Intent::Alliances(action) => {
                    let command = self.alliances.apply(
                        action,
                        bw,
                        bw.alliance_rules,
                        chat_manager,
                        Instant::now(),
                    );
                    // An alliance or vision command carries the whole of the player's setting, so
                    // of several made in one frame only the last is worth sending.
                    if let Some(command) = command {
                        game_commands.retain(|sent: &Vec<u8>| sent.first() != command.first());
                        game_commands.push(command);
                    }
                }
                intent => self.execute_intent(bw, intent, &mut replay_commands),
            }
        }
        self.let_out_look_at(bw.game.frame_count());
        let prefs = *self.shell.panel_prefs();
        let observer_panels_changed = (self.saved_observer_panels != Some(prefs)).then(|| {
            self.saved_observer_panels = Some(prefs);
            prefs
        });
        overlay_ui::kit::pixels::crisp_hairlines(&mut output.shapes, pixels_per_point);
        let ui_primitives = self.ctx.tessellate(output.shapes, pixels_per_point);
        let primitives = vec![(self.draw_layer, ui_primitives)];
        StepOutput {
            textures_delta: output.textures_delta,
            primitives,
            replay_visions: self.out_state.replay_visions,
            select_unit: self.out_state.select_unit,
            show_hide_control: self.out_state.show_hide_control,
            show_hide_graphic_layer: self.out_state.show_hide_graphic_layer,
            // A watcher keeps only the minimap of the console; a player always has all of it.
            console_visible: !bw.is_replay_or_obs,
            minimap_visible: !bw.is_replay_or_obs || prefs.minimap,
            command_panel_visible: !frame_output.transport_shown,
            replay_commands,
            game_commands,
            setting_changes,
            observer_panels_changed,
            statbtn_dialog_offset: self.replay_ui_values.statbtn_dialog_offset,
            run_second_draw: screen_size_changed,
            leave_game: self.out_state.leave_game,
            look_at: self.out_state.look_at,
            select_group: self.out_state.select_group.take(),
            clear_selection: std::mem::take(&mut self.out_state.clear_selection),
            follow_unit: self.out_state.follow_unit,
            bottom_overpan_share: if bw.is_replay_or_obs {
                self.bottom_band_share
            } else {
                0.0
            },
        }
    }

    /// Tells the shell about every replaced native dialog that has spawned or been deleted since
    /// the last frame. The spawn hook records the dialogs as they come and go; the transitions are
    /// what the shell's modal stack is built from.
    fn sync_native_dialogs(&mut self, first_dialog: Option<Dialog>) {
        let live = dialog_hook::live_replaced_dialogs();
        for dialog in NativeDialog::ALL {
            let index = dialog.index();
            if live[index] == self.native_dialogs_live[index] {
                continue;
            }
            self.native_dialogs_live[index] = live[index];
            if live[index] {
                dialog_hook::log_replaced_dialog_controls(first_dialog, dialog);
                self.shell.native_dialog_spawned(dialog);
            } else {
                self.shell.native_dialog_closed(dialog);
            }
        }
    }

    /// Where BW's minimap square is on screen, in overlay points, while its dialog is up.
    ///
    /// The square is the control the map is drawn in. Without that control, it is taken from the
    /// dialog's own rect, which carries the strip of buttons above the map as well as the map: as
    /// wide as the dialog, and as tall as it is wide, from its bottom.
    /// The rect is logged whenever it moves, children and all, which is what to check the square
    /// against when a layout of the game's puts the minimap somewhere new.
    fn minimap_rect(&mut self, bw: &BwVars) -> Option<Rect> {
        let dialog = bw::iter_dialogs(bw.first_dialog)
            .find(|dialog| dialog.as_control().string() == console::MINIMAP_DIALOG)?;
        let control = dialog.as_control();
        if control.is_hidden() {
            return None;
        }
        let area = control.screen_coords();
        if self.logged_minimap_area != Some((area.left, area.top, area.right, area.bottom)) {
            self.logged_minimap_area = Some((area.left, area.top, area.right, area.bottom));
            let children = dialog
                .children()
                .map(|child| {
                    let rect = child.dialog_coords();
                    format!(
                        "{} ({:#x}) {},{}-{},{}{}",
                        child.id(),
                        child.control_type(),
                        rect.left,
                        rect.top,
                        rect.right,
                        rect.bottom,
                        if child.is_hidden() { " hidden" } else { "" },
                    )
                })
                .collect::<Vec<_>>();
            debug!(
                "Minimap dialog at {},{}-{},{}; controls {}",
                area.left,
                area.top,
                area.right,
                area.bottom,
                children.join(", ")
            );
        }
        // The map is drawn in a control of its own, inset from the dialog's edges: with the console
        // art hidden, the dialog's margin around it is see-through, so the square is the control's.
        if let Some(map) = dialog.child_by_id(MINIMAP_MAP_CONTROL) {
            let area = map.screen_coords();
            let min = self.bw_dialog_point_to_egui(area.left, area.top);
            let max = self.bw_dialog_point_to_egui(area.right, area.bottom);
            if max.x > min.x && max.y > min.y {
                return Some(Rect::from_min_max(min, max));
            }
        }
        let min = self.bw_dialog_point_to_egui(area.left, area.top);
        let max = self.bw_dialog_point_to_egui(area.right, area.bottom);
        let width = max.x - min.x;
        if width <= 0.0 || max.y <= min.y {
            return None;
        }
        let side = width.min(max.y - min.y);
        Some(Rect::from_min_max(
            pos2(min.x, max.y - side),
            pos2(max.x, max.y),
        ))
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
        ui.collapsing("Fog of war", fog_style_debug_ui);
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
        ui.add(Slider::new(&mut self.draw_layer, 0u16..=OVERLAY_DRAW_LAYER).text("Draw layer"));
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
                                bw::control_text(&ctrl),
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

    /// Hands the waiting look at a place to the game once the replay is at the frame its seek asked
    /// for, and gives it up once it has waited too long for that.
    fn let_out_look_at(&mut self, frame: u32) {
        let Some(pending) = &self.pending_look_at else {
            return;
        };
        if (pending.frame..=pending.frame.saturating_add(LOOK_AT_WINDOW_FRAMES)).contains(&frame) {
            debug!(
                "Looking at {},{} after the seek to {} landed on {frame}",
                pending.point.x, pending.point.y, pending.frame
            );
            self.out_state.look_at = Some(bw::Point {
                x: pending.point.x,
                y: pending.point.y,
            });
            self.pending_look_at = None;
        } else if pending.asked.elapsed() > LOOK_AT_TIMEOUT {
            debug!(
                "Gave up looking at {},{}: the seek to {} never landed",
                pending.point.x, pending.point.y, pending.frame
            );
            self.pending_look_at = None;
        }
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
            // Both leave a game this client cannot play on any more, its session over or its link
            // given up on, so no other player can be told through the game and the session's own
            // leave handling speaks for it.
            Intent::LeaveGame | Intent::AbandonGame => self.out_state.leave_game = true,
            Intent::QuitGame => dialog_hook::begin_quit(bw.first_dialog),
            Intent::SetPaused(paused) => {
                dialog_hook::set_paused(bw.first_dialog, paused, bw.pause_control)
            }
            // The game's result is already reported by the time the card is up, so a result dialog
            // that has no End Mission to press is left by ending the game loop instead, rather than
            // keeping the player in a game they asked to leave.
            Intent::EndMission(dialog) => {
                if !dialog_hook::end_mission(bw.first_dialog, dialog) {
                    self.out_state.leave_game = true;
                }
            }
            Intent::OpenGameMenu => dialog_hook::open_game_menu(bw.first_dialog),
            Intent::OpenObjectives => dialog_hook::open_objectives(bw.first_dialog),
            Intent::Seek(frame) => {
                self.last_requested_seek = Some(frame);
                replay_commands.push(ReplayCommand::Seek { frame });
            }
            Intent::LookAt(point) => {
                self.pending_look_at = self.last_requested_seek.map(|frame| PendingLookAt {
                    frame,
                    point,
                    asked: Instant::now(),
                });
            }
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
            Intent::PickSelectedUnit(index) => {
                let selected = bw.client_selection.iter().flatten();
                let alone = selected.clone().count() == 1;
                if let Some(&unit) = selected.clone().nth(index) {
                    if alone {
                        self.out_state.look_at = Some(unit.position());
                    } else {
                        self.out_state.select_group = Some(GroupSelection {
                            units: vec![unit],
                            center: false,
                        });
                    }
                }
            }
            Intent::ClearSelection => self.out_state.clear_selection = true,
            Intent::FollowSelectedUnit(index) => {
                self.out_state.follow_unit =
                    bw.client_selection.iter().flatten().nth(index).copied();
            }
            Intent::SelectControlGroup { player_id, key } => {
                let now = Instant::now();
                let center = self.last_group_recall.is_some_and(|(player, group, at)| {
                    player == player_id
                        && group == key
                        && now.duration_since(at) < GROUP_DOUBLE_PRESS
                });
                self.last_group_recall = Some((player_id, key, now));
                let units = match &bw.units {
                    Some(units) => game_stats::control_group_units(bw.game, units, player_id, key),
                    None => Vec::new(),
                };
                if !units.is_empty() {
                    self.out_state.select_group = Some(GroupSelection { units, center });
                }
            }
            // Collected by `step` for the game to apply, since the game owns the settings.
            Intent::ChangeSetting(_) => {}
            // Carried out by `step`, which holds the chat settings they act on.
            Intent::Alliances(_) => {}
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
    /// menus is on top. Only for the debug window; every other rect the frame owns comes from the
    /// shell.
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
    /// Only ever returns the plain arrow.
    pub fn decide_cursor_type(&self) -> Option<BwCursorType> {
        // While a modal of ours is taking the pointer the sim is usually frozen, and with it BW's
        // per-frame cursor selection, so the cursor would otherwise stay whatever shape it had when
        // the modal came up (a hover or drag cursor over nothing). Pin the plain pointer instead.
        // A BW menu the player is operating lifts the capture, so its own cursor handling runs.
        if self.capture.blocks_game_pointer() {
            return Some(BwCursorType::Arrow);
        }
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
                        // BW gets a press only while the overlay isn't taking the pointer, and gets
                        // a release exactly when it got the press: a swallowed release would leave
                        // it mid-drag-select with no way to finish, and an orphan release (press
                        // swallowed, release delivered) is an input sequence BW never expects.
                        let deliver = if pressed {
                            !self.capture.blocks_game_pointer()
                        } else {
                            self.bw_mouse_down[button_idx]
                        };
                        self.bw_mouse_down[button_idx] = pressed && deliver;
                        return if deliver { None } else { Some(0) };
                    }
                    self.bw_mouse_down[button_idx] = false;
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
                        // A mouse wheel has no scroll phase; `Move` is the value egui documents for
                        // that case.
                        phase: egui::TouchPhase::Move,
                        modifiers,
                    });
                    Some(0)
                }
                WM_KEYDOWN | WM_KEYUP | WM_SYSKEYDOWN | WM_SYSKEYUP => {
                    let mut modifiers = current_egui_modifiers();
                    let is_syskey = matches!(msg, WM_SYSKEYDOWN | WM_SYSKEYUP);
                    let pressed = matches!(msg, WM_KEYDOWN | WM_SYSKEYDOWN);
                    let vkey = wparam as i32;
                    // Windows sends an Alt chord as a system key, and F10 too, Alt or not: it is the
                    // key that opens a window's menu bar.
                    modifiers.alt |= is_syskey && vkey != VK_F10;
                    let key = vkey_to_egui_key(vkey);
                    let scan_code = message_scan_code(lparam);
                    if !pressed {
                        if let Some(index) = self
                            .shell_held_keys
                            .iter()
                            .position(|&held| held == scan_code)
                        {
                            self.shell_held_keys.swap_remove(index);
                            return Some(0);
                        }
                    } else if self.shell_held_keys.contains(&scan_code) {
                        // A held key repeating: the shell took the press, so the repeats are its
                        // too, whatever it does with them.
                        if let Some(key) = key {
                            self.shell.key_pressed(key, modifiers);
                        }
                        return Some(0);
                    }
                    if let Some(key) = key {
                        // SC:R's menu keys are the shell's whatever has the keyboard, and so is
                        // every key while a modal whose buttons answer to keys is up: they type
                        // nothing, and a focused control would otherwise take the key that is meant
                        // for one of the buttons. The shell leaves what it has no use for, such as a
                        // focused slider's arrow keys, to go on to the control.
                        if pressed
                            && (hotkeys::is_game_menu_key(key, modifiers)
                                || self
                                    .shell
                                    .top_modal()
                                    .is_some_and(ModalId::buttons_answer_to_keys))
                            && self.shell.key_pressed(key, modifiers)
                        {
                            self.shell_held_keys.push(scan_code);
                            return Some(0);
                        }
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
                            self.shell_held_keys.push(scan_code);
                            return Some(0);
                        }
                    }
                    if self.capture.blocks_game_key(key) {
                        return Some(0);
                    }
                    None
                }
                WM_CHAR | WM_SYSCHAR
                    if self.shell_held_keys.contains(&message_scan_code(lparam)) =>
                {
                    Some(0)
                }
                WM_CHAR => {
                    if !self.ctx.egui_wants_keyboard_input() {
                        // Kept from the game only under a modal the player may not chat from:
                        // SC:R opens its chat box from the Enter character.
                        return match self.capture.blocks_game_char() {
                            true => Some(0),
                            false => None,
                        };
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
        if self.mouse_scaling {
            return scaled_mouse_pos_to_egui(
                (x, y),
                (self.window_size.0 as f32, self.window_size.1 as f32),
                (self.screen_size.0 as f32, self.screen_size.1 as f32),
            );
        }
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

/// Live controls for how the transparent starting fog draws never-explored terrain.
fn fog_style_debug_ui(ui: &mut egui::Ui) {
    use super::fog_style::{self, FogStyle, ViewFogStyle};

    fn view_ui(ui: &mut egui::Ui, view: &mut ViewFogStyle) {
        for (value, text) in [
            (&mut view.unexplored_alpha, "Unexplored darkness"),
            (&mut view.boundary_alpha, "Boundary line"),
        ] {
            ui.add(Slider::new(value, 0.0..=1.0).text(text));
        }
        ui.add(Slider::new(&mut view.boundary_width, 0.5..=6.0).text("Boundary width (px)"));
        ui.add(Slider::new(&mut view.boundary_brightness, 0.0..=1.5).text("Boundary brightness"));
    }

    let mut style = fog_style::fog_style();
    ui.label("Game view");
    view_ui(ui, &mut style.game);
    ui.add(Slider::new(&mut style.grain_strength, 0.0..=1.0).text("Grain strength"));
    ui.add(Slider::new(&mut style.grain_scale, 0.25..=4.0).text("Grain scale"));
    ui.separator();
    ui.label("Minimap");
    view_ui(ui, &mut style.minimap);
    ui.separator();
    ui.add(
        Slider::new(&mut style.boundary_smoothing, 0.0..=32.0)
            .text("Boundary smoothing (map px, both)"),
    );
    ui.label("Explored fog is 0.67 darkness.");
    if ui.button("Reset").clicked() {
        style = FogStyle::DEFAULT;
    }
    if ui.button("Log values").clicked() {
        info!("Fog style: {style:?}");
    }
    fog_style::set_fog_style(style);
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
    player_teams_for(bw, |player_id| is_active_player(bw, player_id))
}

/// Groups the slots included by a surface, including departed players when it still lists them.
fn player_teams_for(bw: &BwVars, included: impl Fn(usize) -> bool) -> [u8; 8] {
    let mut teams = [0u8; 8];
    let mut any_team = false;
    for (player_id, team) in teams.iter_mut().enumerate() {
        if !included(player_id) {
            continue;
        }
        *team = unsafe { (*bw.players.add(player_id)).team };
        any_team |= *team != 0;
    }
    if any_team {
        return numbered_from_one(teams, included);
    }
    alliance_teams(bw, included)
}

/// Renumbers the active slots' sides 1, 2, 3 in the order of the game's own numbers, which is what
/// every surface names them by: the game's numbers can start at zero or skip, and a watcher reads
/// "Team 0" or a missing "Team 2" as a mistake.
fn numbered_from_one(teams: [u8; 8], active: impl Fn(usize) -> bool) -> [u8; 8] {
    let mut seen: Vec<u8> = (0..8)
        .filter(|&player_id| active(player_id))
        .map(|player_id| teams[player_id])
        .collect();
    seen.sort_unstable();
    seen.dedup();
    let mut numbered = [0u8; 8];
    for (player_id, team) in numbered.iter_mut().enumerate() {
        if active(player_id) {
            let position = seen
                .iter()
                .position(|&raw| raw == teams[player_id])
                .unwrap_or(0);
            *team = position as u8 + 1;
        }
    }
    numbered
}

/// Groups the active slots by who they are mutually allied with, numbering the groups in slot
/// order so a side is called after where it sits rather than after an empty slot beside it.
///
/// A one-way alliance is not a side: a player who has allied someone who has not allied them back
/// is fighting alone, whatever they have declared.
fn alliance_teams(bw: &BwVars, included: impl Fn(usize) -> bool) -> [u8; 8] {
    let mut teams = [0u8; 8];
    let mut next = 1u8;
    for player_id in 0..8 {
        if teams[player_id] != 0 || !included(player_id) {
            continue;
        }
        let group = next;
        next += 1;
        for (other, team) in teams.iter_mut().enumerate().skip(player_id) {
            if *team != 0 || !included(other) {
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
        let race = stats::player_race(bw, player_id);
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

/// Whether a letter key is down on the keyboard right now, with the game's own window in front: a
/// key held after switching away is no longer held at the game. Read from the keyboard rather than
/// from key messages, which a switch away can leave without their key-up. Keys other than letters
/// are never reported down.
fn letter_key_is_down(key: egui::Key) -> bool {
    use winapi::um::processthreadsapi::GetCurrentProcessId;
    use winapi::um::winuser::{GetAsyncKeyState, GetForegroundWindow, GetWindowThreadProcessId};

    let name = key.name();
    let [letter] = name.as_bytes() else {
        return false;
    };
    if !letter.is_ascii_uppercase() {
        return false;
    }
    unsafe {
        let mut process = 0;
        GetWindowThreadProcessId(GetForegroundWindow(), &mut process);
        process == GetCurrentProcessId()
            && GetAsyncKeyState(i32::from(*letter)) as u16 & 0x8000 != 0
    }
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
        VK_SUBTRACT | VK_OEM_MINUS => Minus,
        VK_ADD => Plus,
        // The punctuation keys as a US layout places them, which is where SC:R's own bindings for
        // them sit.
        VK_OEM_PLUS => Equals,
        VK_OEM_COMMA => Comma,
        VK_OEM_PERIOD => Period,
        VK_OEM_1 => Semicolon,
        VK_OEM_2 => Slash,
        VK_OEM_3 => Backtick,
        VK_OEM_4 => OpenBracket,
        VK_OEM_5 => Backslash,
        VK_OEM_6 => CloseBracket,
        VK_OEM_7 => Quote,
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

#[cfg(test)]
mod tests {
    use super::{numbered_from_one, scaled_mouse_pos_to_egui};

    use egui::pos2;

    #[test]
    fn scaled_mouse_positions_are_read_from_the_box_in_the_middle_of_the_window() {
        // A 16:9 window 1600x900, drawn 1600x900 points: the box is 853x480 game pixels.
        let window = (1600.0, 900.0);
        let screen = (1600.0, 900.0);
        let origin = ((1600 - 853) / 2, (900 - 480) / 2);
        assert_eq!(
            scaled_mouse_pos_to_egui(origin, window, screen),
            pos2(0.0, 0.0)
        );
        let middle = scaled_mouse_pos_to_egui((origin.0 + 426, origin.1 + 240), window, screen);
        assert!(
            (middle.x - 799.06).abs() < 0.01 && middle.y == 450.0,
            "{middle:?}"
        );
        // Outside the box is the box's edge, as the game clamps it.
        assert_eq!(
            scaled_mouse_pos_to_egui((0, 0), window, screen),
            pos2(0.0, 0.0)
        );
    }

    #[test]
    fn sides_are_numbered_from_one_in_the_games_own_order() {
        let active = |player_id: usize| player_id < 4;
        assert_eq!(
            numbered_from_one([0, 0, 1, 1, 0, 0, 0, 0], active),
            [1, 1, 2, 2, 0, 0, 0, 0]
        );
        // Numbers that skip are closed up, and empty slots keep no side.
        assert_eq!(
            numbered_from_one([3, 1, 3, 1, 7, 7, 7, 7], active),
            [2, 1, 2, 1, 0, 0, 0, 0]
        );
    }
}
