//! Visibility and input policy for the original in-game interface.

use egui::{Key, Modifiers};

/// The original viewer's independently toggleable surfaces.
pub struct ClassicUiState {
    pub show_statistics: bool,
    pub show_production: bool,
    pub show_console: bool,
}

impl Default for ClassicUiState {
    fn default() -> Self {
        Self {
            show_statistics: true,
            show_production: true,
            show_console: true,
        }
    }
}

impl ClassicUiState {
    pub fn restore_production(&mut self, prefs: &crate::shell::PanelPrefs) {
        self.show_production = prefs.classic_production;
    }

    /// Copies a changed build-queue preference for the host to save.
    pub fn save_production(&self, prefs: &mut crate::shell::PanelPrefs) -> bool {
        if prefs.classic_production == self.show_production {
            return false;
        }
        prefs.classic_production = self.show_production;
        true
    }

    /// Takes only the reference viewer's four toggle keys. Playback remains the game's.
    pub fn handle_key(&mut self, key: Key, _modifiers: Modifiers, active: bool) -> bool {
        if !active {
            return false;
        }
        match key {
            Key::A => {
                let show = !self.show_statistics || !self.show_production || !self.show_console;
                self.show_statistics = show;
                self.show_production = show;
                self.show_console = show;
            }
            Key::E => self.show_statistics = !self.show_statistics,
            Key::F => self.show_production = !self.show_production,
            Key::W => self.show_console = !self.show_console,
            _ => return false,
        }
        true
    }

    pub fn console_visible(&self, spectating: bool) -> bool {
        !spectating || self.show_console
    }
}

/// The viewer's toggles must never take a key from chat or a native dialog.
pub fn viewer_hotkeys_active(started: bool, spectating: bool, menu: bool, chat: bool) -> bool {
    started && spectating && !menu && !chat
}

/// Reference UI scaling keeps SD text at its original size.
pub fn pixels_per_point(height: f32) -> f32 {
    (height / 1080.0).max(1.0)
}

/// Native timeout controls cannot operate ShieldBattery's netcode-v2 transport.
pub fn replace_native_dialog(name: &str, netcode_v2: bool) -> bool {
    netcode_v2 && name.eq_ignore_ascii_case("TimeOut")
}

/// Selects native dialog replacements for either interface without changing transport policy.
pub fn dialog_replacement(
    name: &str,
    original: bool,
    netcode_v2: bool,
    replay: bool,
    spectating: bool,
) -> Option<crate::shell::NativeDialog> {
    use crate::shell::{NativeDialog, native_dialogs};
    let dialog = native_dialogs::replacement_for(name)?;
    if original {
        return replace_native_dialog(name, netcode_v2).then_some(dialog);
    }
    match dialog {
        NativeDialog::TimeOut => netcode_v2.then_some(dialog),
        NativeDialog::ChatHistory | NativeDialog::GameMenu => Some(dialog),
        NativeDialog::Victory | NativeDialog::Defeat => (!replay).then_some(dialog),
        NativeDialog::AllianceFilter | NativeDialog::MessageFilter => {
            (!spectating).then_some(dialog)
        }
    }
}

/// Chat keeps its keyboard carve-out; only native menus lift the gameplay block entirely.
pub fn native_menu_takes_input(name: &str, visible: bool) -> bool {
    visible
        && !["Minimap", "TimeOut", "TextBox"]
            .iter()
            .any(|other| name.eq_ignore_ascii_case(other))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interface_mode_preserves_network_timeout_and_selects_native_menus() {
        use crate::shell::NativeDialog;
        assert_eq!(
            dialog_replacement("GameMenu", true, true, false, false),
            None
        );
        assert_eq!(
            dialog_replacement("GameMenu", false, true, false, false),
            Some(NativeDialog::GameMenu)
        );
        for original in [false, true] {
            assert_eq!(
                dialog_replacement("TimeOut", original, true, false, false),
                Some(NativeDialog::TimeOut)
            );
            assert_eq!(
                dialog_replacement("TimeOut", original, false, false, false),
                None
            );
        }
        assert_eq!(
            dialog_replacement("WMission", false, true, true, true),
            None
        );
        assert_eq!(
            dialog_replacement("AllyFltr", false, true, false, true),
            None
        );
    }
    use egui::{Key, Modifiers};

    fn original_frame(
        shell: &mut crate::shell::Shell,
        host: &crate::shell::HostFrame,
        views: &mut crate::shell::Views<'_>,
    ) -> crate::shell::FrameOutput {
        let ctx = egui::Context::default();
        crate::install_classic_fonts_and_style(&ctx, &crate::DynamicFonts::default());
        let mut output = None;
        let mut full = ctx.run_ui(egui::RawInput::default(), |_| {
            output = Some(shell.frame_classic(&ctx, host, views));
        });
        full.textures_delta.clear();
        output.unwrap()
    }

    #[test]
    fn original_frame_does_not_draw_or_capture_a_modern_menu() {
        let mut shell = crate::shell::Shell::new();
        shell.native_dialog_spawned(crate::shell::NativeDialog::GameMenu);
        let host = crate::shell::HostFrame {
            game_started: true,
            mode: crate::shell::Mode::Replay,
            ..Default::default()
        };
        let output = original_frame(&mut shell, &host, &mut crate::shell::Views::default());
        assert_eq!(output.capture, crate::shell::InputCapture::PASS_THROUGH);
        assert!(output.hit_rects.is_empty() && output.intents.is_empty());
        assert!(!output.playback_controls_shown);
    }

    #[test]
    fn original_disconnect_capture_keeps_chat_and_the_native_menu_available() {
        let view = crate::disconnect::DisconnectView {
            rows: vec![],
            self_state: crate::disconnect::SelfState::Reconnecting,
            self_seconds: 4,
        };
        let mut views = crate::shell::Views {
            disconnect: Some(crate::shell::DisconnectSurface {
                view: &view,
                blocks_input: true,
            }),
            ..Default::default()
        };
        let mut shell = crate::shell::Shell::new();
        let mut host = crate::shell::HostFrame {
            game_started: true,
            ..Default::default()
        };
        let output = original_frame(&mut shell, &host, &mut views);
        assert!(output.capture.blocks_game_pointer());
        assert!(!output.capture.blocks_game_key(Some(Key::F10)));
        assert!(!output.capture.blocks_game_key(Some(Key::Enter)));
        host.native_menu_open = true;
        let output = original_frame(&mut shell, &host, &mut views);
        assert_eq!(output.capture, crate::shell::InputCapture::PASS_THROUGH);
        assert!(output.hit_rects.is_empty());
    }

    #[test]
    fn viewers_start_with_the_original_panels_visible() {
        let state = ClassicUiState::default();
        assert!(state.show_statistics && state.show_production && state.show_console);
    }

    #[test]
    fn each_original_key_only_toggles_its_panel() {
        let mut state = ClassicUiState::default();
        for key in [Key::E, Key::F, Key::W] {
            assert!(state.handle_key(key, Modifiers::NONE, true));
        }
        assert!(!state.show_statistics && !state.show_production && !state.show_console);
    }

    #[test]
    fn all_restores_a_partial_set_before_hiding_everything() {
        let mut state = ClassicUiState::default();
        state.handle_key(Key::F, Modifiers::NONE, true);
        state.handle_key(Key::A, Modifiers::NONE, true);
        assert!(state.show_statistics && state.show_production && state.show_console);
        state.handle_key(Key::A, Modifiers::NONE, true);
        assert!(!state.show_statistics && !state.show_production && !state.show_console);
    }

    #[test]
    fn inactive_and_native_playback_keys_are_left_to_the_game() {
        let mut state = ClassicUiState::default();
        assert!(!state.handle_key(Key::W, Modifiers::NONE, false));
        for key in [Key::P, Key::U, Key::D, Key::Num1, Key::Escape, Key::F10] {
            assert!(!state.handle_key(key, Modifiers::NONE, true));
        }
        assert!(state.show_console);
    }

    #[test]
    fn original_toggle_keys_accept_modifiers() {
        let mut state = ClassicUiState::default();
        assert!(state.handle_key(Key::W, Modifiers::CTRL, true));
        assert!(!state.show_console);
        assert!(state.console_visible(false));
        assert!(!state.console_visible(true));
    }

    #[test]
    fn chat_and_native_menus_own_the_keyboard() {
        assert!(viewer_hotkeys_active(true, true, false, false));
        for args in [
            (false, true, false, false),
            (true, false, false, false),
            (true, true, true, false),
            (true, true, false, true),
        ] {
            assert!(!viewer_hotkeys_active(args.0, args.1, args.2, args.3));
        }
    }

    #[test]
    fn original_scaling_does_not_shrink_sd_panels() {
        assert_eq!(pixels_per_point(960.0), 1.0);
        assert_eq!(pixels_per_point(1080.0), 1.0);
        assert_eq!(pixels_per_point(2160.0), 2.0);
    }

    #[test]
    fn native_dialogs_are_only_replaced_for_the_netcode_timeout() {
        for name in [
            "GameMenu",
            "ChatHistory",
            "WMission",
            "LMission",
            "AllyFltr",
            "TeamFltr",
            "MsgFltr",
            "Other",
        ] {
            assert!(!replace_native_dialog(name, true), "{name}");
            assert!(!replace_native_dialog(name, false), "{name}");
        }
        assert!(replace_native_dialog("TimeOut", true));
        assert!(replace_native_dialog("timeout", true));
        assert!(!replace_native_dialog("TimeOut", false));
    }

    #[test]
    fn only_visible_native_menus_take_priority_over_disconnect_input() {
        for name in ["GameMenu", "IDD_OPTIONS_POPUP", "QuitRepl", "WMission"] {
            assert!(native_menu_takes_input(name, true));
            assert!(!native_menu_takes_input(name, false));
        }
        for name in ["Minimap", "TimeOut", "TextBox"] {
            assert!(!native_menu_takes_input(name, true));
        }
    }
}

#[cfg(test)]
mod persistence_tests {
    use super::*;
    use crate::shell::PanelPrefs;

    #[test]
    fn build_queue_visibility_survives_replay_restarts_in_both_directions() {
        let mut viewer = ClassicUiState::default();
        let mut prefs = PanelPrefs::default();
        viewer.handle_key(Key::F, Modifiers::NONE, true);
        assert!(viewer.save_production(&mut prefs));
        assert!(!viewer.save_production(&mut prefs));
        let loaded: PanelPrefs =
            serde_json::from_str(&serde_json::to_string(&prefs).unwrap()).unwrap();
        let mut next = ClassicUiState::default();
        next.restore_production(&loaded);
        assert!(!next.show_production);
        next.handle_key(Key::F, Modifiers::NONE, true);
        assert!(next.save_production(&mut prefs));
        let loaded: PanelPrefs =
            serde_json::from_str(&serde_json::to_string(&prefs).unwrap()).unwrap();
        let mut reopened = ClassicUiState::default();
        reopened.restore_production(&loaded);
        assert!(reopened.show_production);
    }

    #[test]
    fn legacy_settings_keep_the_build_queue_visible() {
        let prefs: PanelPrefs = serde_json::from_str(r#"{"production":false}"#).unwrap();
        let mut viewer = ClassicUiState::default();
        viewer.restore_production(&prefs);
        assert!(viewer.show_production);
    }
}
