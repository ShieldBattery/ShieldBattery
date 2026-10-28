//! Shells and frames for the shell's tests, set up the way a host sets them up.

use egui::{Context, Key, Modifiers, Rect};

use super::{FrameOutput, HostFrame, Intent, ModalId, Mode, Shell, Views};
use crate::disconnect::{DisconnectView, SelfState};
use crate::observer::{
    ControlGroupsView, EconomyView, GraphLineView, GraphsView, MapControlSideView, MapControlView,
    MatchupView, MilitaryPlayerView, MilitaryView, ObserverView, ProductionIcon, ProductionView,
    RaceView, SelectedUnitView, SelectionView, TimelineView,
};
use crate::playback_controls::PlaybackView;

pub(super) fn spectating_shell() -> Shell {
    let mut shell = Shell::new();
    shell.set_host(&HostFrame {
        mode: Mode::Replay,
        game_started: true,
        native_textbox_open: false,
        native_dialog_open: false,
        native_menu_open: false,
        game_seconds: 0,
        pause_control: None,
        minimap_rect: None,
    });
    shell
}

/// A replay a few minutes in, running at the speed it was recorded at.
pub(super) fn replay() -> PlaybackView {
    PlaybackView {
        elapsed_frames: 20_000,
        end_frames: 60_000,
        game_speed: 6,
        paused: false,
        speed_index: 6,
        multiplier: 1,
        spoiler_free: false,
        seek_pending: false,
    }
}

/// A game with nobody in it, which is enough for the panels to be placed and drawn.
pub(super) fn empty_game() -> ObserverView {
    ObserverView {
        matchup: MatchupView {
            players: Vec::new(),
            elapsed_secs: 0,
            is_replay: true,
        },
        team_cards: None,
        economy: EconomyView {
            players: Vec::new(),
        },
        military: MilitaryView {
            players: Vec::new(),
        },
        graphs: GraphsView {
            series: Default::default(),
            span_secs: 0,
            lines: Vec::new(),
            grouping: None,
        },
        timeline: TimelineView { events: Vec::new() },
        production: ProductionView {
            players: Vec::new(),
        },
        control_groups: ControlGroupsView::default(),
        selection: SelectionView::default(),
        map_control: None,
    }
}

/// [`empty_game`] with two players in it as far as the military panel and the graphs are concerned,
/// which is what puts those two wings on the right edge, and a map-control reading, which gives the
/// dock a row for its bar.
pub(super) fn game_with_right_wings() -> ObserverView {
    let mut game = empty_game();
    for (index, name) in ["Rhynso", "tec27"].into_iter().enumerate() {
        let color = crate::kit::theme::player_color(index);
        game.military.players.push(MilitaryPlayerView {
            name: name.to_string(),
            team: index as u8,
            color,
            vision: true,
            race: RaceView::Zerg,
            army_minerals: 0,
            army_gas: 0,
            units_killed: 0,
            units_lost: 0,
            worker_kills: 0,
            worker_losses: 0,
        });
        game.graphs.lines.push(GraphLineView {
            label: name.to_string(),
            color,
            values: vec![0.0, 4.0, 8.0],
        });
    }
    game.graphs.span_secs = 60;
    game.map_control = Some(MapControlView {
        left: MapControlSideView {
            color: crate::kit::theme::player_color(0),
            share: 0.4,
        },
        right: MapControlSideView {
            color: crate::kit::theme::player_color(1),
            share: 0.4,
        },
    });
    game
}

/// `game` with one of the first player's units selected, which puts the selection panel up.
pub(super) fn with_a_selection(mut game: ObserverView) -> ObserverView {
    game.selection.units.push(SelectedUnitView {
        icon: ProductionIcon {
            texture: None,
            index: 0x29,
            size: None,
            margin: 0.0,
            wireframe: None,
        },
        name: Some("Zerg Drone".to_string()),
        owner_color: crate::kit::theme::player_color(0),
        owner_name: "Rhynso".to_string(),
        owner: Some(0),
        hit_points: Some((40, 40)),
        shields: None,
        energy: None,
        kills: 0,
        status: None,
        hallucination: false,
        parasited: false,
        blind: false,
        building: false,
        resources: None,
        stacked: None,
        production: None,
        cargo: Vec::new(),
        upgrades: Vec::new(),
    });
    game
}

/// A context with the overlay's own fonts, which is what a screen lays its text out with.
pub(super) fn fresh_ctx() -> Context {
    let ctx = Context::default();
    crate::install_fonts_and_style(&ctx, &crate::DynamicFonts::default());
    ctx
}

/// Runs one shell frame the way a host does, at `time` on the context's clock.
pub(super) fn run_frame_at(
    shell: &mut Shell,
    ctx: &Context,
    playback: Option<&PlaybackView>,
    time: f64,
) -> FrameOutput {
    run_frame_with_events(shell, ctx, playback, time, Vec::new())
}

/// The screen a test frame is drawn on unless it asks for another.
const SCREEN: egui::Vec2 = egui::vec2(1280.0, 720.0);

/// Runs one shell frame of a replay being watched with the observer panels, at `time`, on a screen
/// `screen` points across.
pub(super) fn run_watched_frame_at(
    shell: &mut Shell,
    ctx: &Context,
    playback: &PlaybackView,
    observer: &ObserverView,
    screen: egui::Vec2,
    time: f64,
) -> FrameOutput {
    run_watched_frame_with_minimap(shell, ctx, playback, observer, screen, None, time)
}

/// [`run_watched_frame_at`] with the host reporting BW's minimap at `minimap`, or reporting none,
/// as it does while the minimap is hidden.
pub(super) fn run_watched_frame_with_minimap(
    shell: &mut Shell,
    ctx: &Context,
    playback: &PlaybackView,
    observer: &ObserverView,
    screen: egui::Vec2,
    minimap: Option<Rect>,
    time: f64,
) -> FrameOutput {
    let views = Views {
        playback: Some(playback),
        observer: Some(observer),
        ..Views::default()
    };
    run_frame_on(shell, ctx, views, screen, minimap, time, Vec::new())
}

/// Runs one shell frame after `keys` were pressed, each offered to the shell first and handed to
/// the overlay's controls where the shell leaves it, the way the game's host routes them.
pub(super) fn run_frame_with_keys(shell: &mut Shell, ctx: &Context, keys: &[Key]) -> FrameOutput {
    let events = keys
        .iter()
        .filter(|&&key| !shell.key_pressed(key, Modifiers::NONE))
        .flat_map(|&key| {
            [true, false].map(|pressed| egui::Event::Key {
                key,
                physical_key: None,
                pressed,
                repeat: false,
                modifiers: Modifiers::NONE,
            })
        })
        .collect();
    let time = ctx.input(|input| input.time) + 1.0;
    run_frame_with_events(shell, ctx, None, time, events)
}

fn run_frame_with_events(
    shell: &mut Shell,
    ctx: &Context,
    playback: Option<&PlaybackView>,
    time: f64,
    events: Vec<egui::Event>,
) -> FrameOutput {
    let views = Views {
        playback,
        ..Views::default()
    };
    run_frame_on(shell, ctx, views, SCREEN, None, time, events)
}

fn run_frame_on(
    shell: &mut Shell,
    ctx: &Context,
    mut views: Views<'_>,
    screen: egui::Vec2,
    minimap_rect: Option<Rect>,
    time: f64,
    events: Vec<egui::Event>,
) -> FrameOutput {
    let host = HostFrame {
        mode: shell.host.mode,
        game_started: true,
        native_textbox_open: false,
        native_dialog_open: false,
        native_menu_open: false,
        game_seconds: 0,
        pause_control: None,
        minimap_rect,
    };
    let raw = egui::RawInput {
        screen_rect: Some(Rect::from_min_size(egui::pos2(0.0, 0.0), screen)),
        time: Some(time),
        events,
        ..Default::default()
    };
    ctx.begin_pass(raw);
    let output = shell.frame(ctx, &host, &mut views);
    let mut out = ctx.end_pass();
    let _ = ctx.tessellate(out.shapes, ctx.pixels_per_point());
    out.textures_delta.clear();
    output
}

/// One frame at a time far enough apart that the seek rate limit never decides a test.
pub(super) fn run_frame(
    shell: &mut Shell,
    ctx: &Context,
    playback: Option<&PlaybackView>,
) -> Vec<Intent> {
    let time = ctx.input(|input| input.time) + 1.0;
    run_frame_at(shell, ctx, playback, time).intents
}

/// A disconnect view with something on it: an empty one draws nothing and raises no modal.
pub(super) fn disconnect_view(self_state: SelfState) -> DisconnectView {
    use crate::disconnect::{DisconnectRowView, PeerState};
    DisconnectView {
        rows: vec![DisconnectRowView {
            slot: 3,
            name: "Rhynso".to_string(),
            color: crate::kit::theme::player_color(0),
            teammate: false,
            seconds: 12,
            state: PeerState::LinkLost,
            drop_unlocked: false,
            drop_requested: false,
        }],
        self_state,
        self_seconds: 12,
    }
}

pub(super) fn playing_shell() -> Shell {
    let mut shell = Shell::new();
    shell.set_host(&HostFrame {
        mode: Mode::Playing,
        game_started: true,
        ..HostFrame::default()
    });
    shell
}

/// Puts one of the disconnect surface's modals on top, the way a frame's status sync does.
pub(super) fn raise_status_modal(shell: &mut Shell, id: ModalId) {
    shell.modals.sync_status(Some((id, true)));
}
