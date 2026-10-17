//! Shells and frames for the shell's tests, set up the way a host sets them up.

use egui::{Context, Rect};

use super::{FrameOutput, HostFrame, Intent, ModalId, Mode, Shell, Views};
use crate::disconnect::{DisconnectView, SelfState};
use crate::transport::TransportView;

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
pub(super) fn replay() -> TransportView {
    TransportView {
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
    transport: Option<&TransportView>,
    time: f64,
) -> FrameOutput {
    let host = HostFrame {
        mode: shell.host.mode,
        game_started: true,
        native_textbox_open: false,
        native_dialog_open: false,
        native_menu_open: false,
        game_seconds: 0,
        pause_control: None,
        minimap_rect: None,
    };
    let raw = egui::RawInput {
        screen_rect: Some(Rect::from_min_size(
            egui::pos2(0.0, 0.0),
            egui::vec2(1280.0, 720.0),
        )),
        time: Some(time),
        ..Default::default()
    };
    ctx.begin_pass(raw);
    let mut views = Views {
        transport,
        ..Views::default()
    };
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
    transport: Option<&TransportView>,
) -> Vec<Intent> {
    let time = ctx.input(|input| input.time) + 1.0;
    run_frame_at(shell, ctx, transport, time).intents
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
