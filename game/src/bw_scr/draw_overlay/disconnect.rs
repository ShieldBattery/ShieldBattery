use egui::{Align2, CornerRadius, Frame, Margin, RichText, vec2};

use crate::app_messages::GameSetupInfo;
use crate::bw_scr::draw_overlay::{OverlayState, colors, fonts::display_family};
use crate::netcode_v2::DisconnectStatus;

/// Font size for the notice lines, matching the smaller readouts the overlay draws elsewhere.
const LINE_SIZE: f32 = 18.0;

impl OverlayState {
    /// Draws the survivor disconnect notice: a small, translucent, non-interactive panel anchored
    /// top-center that lists each peer whose relay link dropped (with how long the automatic-drop
    /// grace period has run) and, if this client's own link is gone, a distinct line for that.
    ///
    /// Renders in every build — this is product UX, not debug output — and only while there is
    /// something to report; an all-healthy status draws nothing. It registers no UI rect and marks
    /// its area non-interactable, so it never captures mouse or keyboard input: clicks and keys pass
    /// straight through to the game.
    pub(super) fn add_disconnect_overlay(
        &mut self,
        status: &DisconnectStatus,
        setup_info: Option<&GameSetupInfo>,
        ctx: &egui::Context,
    ) {
        if status.peers.is_empty() && !status.self_lost {
            return;
        }

        let users = setup_info.map(|info| info.users.as_slice()).unwrap_or(&[]);

        egui::Area::new("sb_disconnect_overlay".into())
            .anchor(Align2::CENTER_TOP, vec2(0.0, 24.0))
            .order(egui::Order::Foreground)
            .interactable(false)
            .show(ctx, |ui| {
                Frame::default()
                    .fill(colors::CONTAINER_HIGH.gamma_multiply(0.85))
                    .corner_radius(CornerRadius::same(8))
                    .inner_margin(Margin::symmetric(16, 12))
                    .show(ui, |ui| {
                        ui.vertical_centered(|ui| {
                            for peer in &status.peers {
                                let name = users
                                    .iter()
                                    .find(|u| u.id == peer.user_id)
                                    .map(|u| u.name.as_str())
                                    .unwrap_or("Unknown player");
                                let seconds = peer.since.elapsed().as_secs();
                                // TODO(tec27): Translate these
                                let text =
                                    format!("{name} lost connection — waiting… ({seconds}s)");
                                ui.label(
                                    RichText::new(text)
                                        .size(LINE_SIZE)
                                        .color(colors::AMBER90)
                                        .family(display_family()),
                                );
                            }
                            if status.self_lost {
                                ui.label(
                                    RichText::new("Connection to the server lost")
                                        .size(LINE_SIZE)
                                        .color(colors::AMBER90)
                                        .family(display_family()),
                                );
                            }
                        });
                    });
            });
    }
}
