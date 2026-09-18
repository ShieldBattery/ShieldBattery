//! The knobs that stand in for the game state the shell reads, and for the native dialogs the host
//! replaces.
//!
//! The game DLL reads the same state off BW — which vantage point the client is watching from,
//! whether the chat box is open, whether one of BW's own dialogs is on top — and tells the shell
//! about a native dialog the moment its spawn hook hides one. Here every one of those is a switch,
//! so the policy the shell derives from them can be walked through without a game.

use egui::Ui;
use overlay_ui::observer::GraphSeries;
use overlay_ui::shell::{HostFrame, Mode, NativeDialog, Panel, PanelPrefs, Shell};
use serde::{Deserialize, Serialize};

/// Every switch standing in for host state.
#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(default)]
pub struct Knobs {
    pub mode: Mode,
    /// Whether the game is past its loading screen. Panel hotkeys are inert before it is.
    pub game_started: bool,
    /// Whether BW's chat entry box is open for text input, which is the one carve-out in the
    /// shell's capture policy.
    pub native_textbox_open: bool,
    /// Whether one of BW's own dialogs is on top of the game, which is when the keyboard is its.
    pub native_dialog_open: bool,
    /// Whether the emulated game has spawned its waiting-for-players dialog.
    pub time_out_spawned: bool,
    /// Whether the emulated game has spawned its chat log.
    pub chat_history_spawned: bool,
    /// Whether the emulated game has spawned its in-game menu.
    pub game_menu_spawned: bool,
    /// Outlines the rects the shell reports as its own over the emulated screen, which is what
    /// decides whether a click is the overlay's or the game's.
    pub show_hit_rects: bool,
    /// The panel visibility the shell starts a session with. The hotkeys move it from there, and
    /// what they leave behind is persisted, the way a host would persist it per profile.
    pub panels: PanelPrefs,
}

impl Default for Knobs {
    fn default() -> Knobs {
        Knobs {
            mode: Mode::default(),
            game_started: true,
            native_textbox_open: false,
            native_dialog_open: false,
            time_out_spawned: false,
            chat_history_spawned: false,
            game_menu_spawned: false,
            show_hit_rects: false,
            panels: PanelPrefs::default(),
        }
    }
}

impl Knobs {
    pub fn host_frame(&self) -> HostFrame {
        HostFrame {
            mode: self.mode,
            game_started: self.game_started,
            native_textbox_open: self.native_textbox_open,
            native_dialog_open: self.native_dialog_open,
        }
    }

    pub fn spawned(&self, dialog: NativeDialog) -> bool {
        match dialog {
            NativeDialog::TimeOut => self.time_out_spawned,
            NativeDialog::ChatHistory => self.chat_history_spawned,
            NativeDialog::GameMenu => self.game_menu_spawned,
        }
    }

    pub fn set_spawned(&mut self, dialog: NativeDialog, spawned: bool) {
        match dialog {
            NativeDialog::TimeOut => self.time_out_spawned = spawned,
            NativeDialog::ChatHistory => self.chat_history_spawned = spawned,
            NativeDialog::GameMenu => self.game_menu_spawned = spawned,
        }
    }
}

/// Brings the shell's record of the replaced native dialogs in line with the knobs, the way the
/// DLL's draw path brings it in line with what its spawn hook saw.
pub fn sync_native_dialogs(knobs: &Knobs, shell: &mut Shell) {
    for dialog in NativeDialog::ALL {
        let spawned = knobs.spawned(dialog);
        if spawned == shell.native_dialog_live(dialog) {
            continue;
        }
        if spawned {
            shell.native_dialog_spawned(dialog);
        } else {
            shell.native_dialog_closed(dialog);
        }
    }
}

/// The emulated host section of the knob panel. Returns whether anything changed.
pub fn knobs_ui(knobs: &mut Knobs, shell: &mut Shell, ui: &mut Ui) -> bool {
    let mut changed = false;

    ui.horizontal_wrapped(|ui| {
        ui.label("Mode:");
        for mode in [Mode::Playing, Mode::Observing, Mode::Replay] {
            changed |= ui
                .selectable_value(&mut knobs.mode, mode, mode.label())
                .changed();
        }
    });
    changed |= ui
        .checkbox(&mut knobs.game_started, "game started")
        .on_hover_text("Panel hotkeys are inert until the game is past its loading screen.")
        .changed();
    changed |= ui
        .checkbox(&mut knobs.native_textbox_open, "chat box open")
        .on_hover_text(
            "BW's own chat entry box. While it is open every key belongs to it, however modal the \
             screen is.",
        )
        .changed();
    changed |= ui
        .checkbox(&mut knobs.native_dialog_open, "game dialog on top")
        .on_hover_text("One of BW's own menus is up, so the shell claims no hotkeys.")
        .changed();
    changed |= ui
        .checkbox(&mut knobs.show_hit_rects, "show hit rects")
        .changed();

    ui.add_space(8.0);
    ui.strong("Native dialogs");
    ui.label("Spawning one is what the game DLL's dialog hook reports after hiding it.");
    for dialog in NativeDialog::ALL {
        // Every row's buttons carry the same labels, and a label is what egui derives a widget id
        // from, so each row needs a scope of its own.
        ui.push_id(dialog.index(), |ui| {
            ui.horizontal(|ui| {
                let spawned = knobs.spawned(dialog);
                ui.label(dialog.label());
                if ui
                    .add_enabled(!spawned, egui::Button::new("spawn"))
                    .clicked()
                {
                    knobs.set_spawned(dialog, true);
                    changed = true;
                }
                if ui
                    .add_enabled(spawned, egui::Button::new("close"))
                    .clicked()
                {
                    knobs.set_spawned(dialog, false);
                    changed = true;
                }
                match dialog.runtime_name() {
                    Some(name) => ui.weak(name),
                    None => ui.weak("(runtime name not captured)"),
                };
            });
        });
    }

    ui.add_space(8.0);
    ui.strong("Panels");
    ui.label("The hotkeys move these too; what the shell is left holding is what persists.");
    let mut prefs = *shell.panel_prefs();
    let mut prefs_changed = false;
    ui.horizontal_wrapped(|ui| {
        for panel in Panel::ALL {
            let mut shown = prefs.shown(panel);
            if ui.checkbox(&mut shown, panel.label()).changed() {
                prefs.set(panel, shown);
                prefs_changed = true;
            }
        }
    });
    if ui
        .checkbox(&mut prefs.spoiler_free, "spoiler-free")
        .on_hover_text(
            "Withholds the replay's length and how far through it playback is. L moves it too.",
        )
        .changed()
    {
        prefs_changed = true;
    }
    ui.horizontal(|ui| {
        ui.label("graph series:");
        for series in GraphSeries::ALL {
            if ui
                .selectable_value(&mut prefs.graph_series, series, series.label())
                .changed()
            {
                prefs_changed = true;
            }
        }
    });
    if prefs_changed {
        shell.set_panel_prefs(prefs);
        changed = true;
    }

    ui.add_space(8.0);
    ui.collapsing("Hotkeys", |ui| {
        ui.label(
            "Consumed while observing or watching a replay, and only for an action the shell can \
             carry out; everything else is left to the game.",
        );
        egui::Grid::new("shell_hotkeys")
            .num_columns(2)
            .spacing(egui::vec2(12.0, 2.0))
            .show(ui, |ui| {
                for (action, chord) in shell.hotkeys().bindings() {
                    ui.strong(format!("{:?}", chord.key));
                    ui.label(action.label());
                    ui.end_row();
                }
            });
    });

    changed
}
