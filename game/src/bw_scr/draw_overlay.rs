use std::borrow::Cow;
use std::mem;
use std::ptr::NonNull;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use bw_dat::dialog::{Control, Dialog};
use bw_dat::{Race, Unit};
use egui::epaint;
use egui::load::SizedTexture;
use egui::style::TextStyle;
use egui::{
    Align, Align2, Color32, Event, FontData, FontDefinitions, Id, Key, Label, Layout,
    PointerButton, Pos2, Rect, Response, Sense, Slider, TextureId, UiBuilder, Vec2, Widget,
    WidgetText, pos2, vec2,
};
use winapi::shared::windef::{HWND, POINT};

use crate::bw;
use crate::bw::apm_stats::ApmStats;
use crate::game_thread::{self, GameThreadMessage};
use crate::network_manager;

use self::production::ProductionState;

mod production;

pub struct OverlayState {
    ctx: egui::Context,
    start_time: Instant,
    /// Enables / disables UI interaction during OverlayState::step.
    /// Based on what BW dialogs are visible.
    ui_active: bool,
    ui_rects: Vec<UiRect>,
    events: Vec<Event>,
    production: ProductionState,
    replay_panels: ReplayPanelState,
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
    network_debug_state: network_manager::DebugState,
    network_debug_info: NetworkDebugInfo,
    dialog_debug_inspect_children: bool,
}

struct UiRect {
    area: Rect,
    /// Currently and probably forever only true for the debug window.
    capture_mouse_scroll: bool,
}

struct ReplayUiValues {
    name_width: f32,
    resource_width: f32,
    supply_width: f32,
    workers_width: f32,
    apm_width: f32,
    production_pos: (f32, f32),
    production_image_size: f32,
    production_max: u32,
    statbtn_dialog_offset: (i32, i32),
}

struct ReplayPanelState {
    hotkeys_active: bool,
    show_statistics: bool,
    show_production: bool,
    show_console: bool,
}

/// One request from async thread will be active at once, check if it had completed
/// when rendering a new frame, and if it has then start a new request.
/// Otherwise re-render with old data.
///
/// Maybe this should be at BwScr level so that this module is more contained without
/// triggering changes and having dependencies on rest of the program?
struct NetworkDebugInfo {
    current_request: Option<Arc<OnceLock<network_manager::DebugInfo>>>,
    previous: Option<Arc<OnceLock<network_manager::DebugInfo>>>,
    previous_time: Instant,
}

/// State that will be in StepOutput; mutated through &mut self
/// during child functions of step()
struct OutState {
    replay_visions: u8,
    select_unit: Option<Unit>,
    // true => show, false => hide
    show_hide_control: Option<(Control, bool)>,
    show_hide_graphic_layer: Option<(u8, bool)>,
    show_console: bool,
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
    pub show_console: bool,
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
    pub first_player_unit: *mut *mut bw::Unit,
    pub first_dialog: Option<Dialog>,
    pub graphic_layers: Option<NonNull<bw::GraphicLayer>>,
    pub is_hd: bool,
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

trait UiExt {
    fn add_fixed_width<W: Widget>(&mut self, widget: W, width: f32);
    fn with_fixed_width<F: FnOnce(&mut Self)>(&mut self, width: f32, add_widgets: F);
}

impl UiExt for egui::Ui {
    fn add_fixed_width<W: Widget>(&mut self, widget: W, width: f32) {
        self.with_fixed_width(width, |ui| {
            ui.add(widget);
        })
    }

    fn with_fixed_width<F: FnOnce(&mut Self)>(&mut self, width: f32, add_widgets: F) {
        // egui doesn't like infinite sizes for ui rects (has a debug assertion),
        // so just replace infinite sides with very large end..
        // Not really sure what this should use anyway.
        let child_rect = self.cursor().intersect(Rect::from_center_size(
            pos2(0.0, 0.0),
            vec2(10000.0, 10000.0),
        ));
        let mut child_ui =
            self.new_child(UiBuilder::new().max_rect(child_rect).layout(*self.layout()));

        let mut clip_rect = child_ui.cursor();
        clip_rect.set_width(width);
        child_ui.set_clip_rect(clip_rect);

        add_widgets(&mut child_ui);
        let mut final_child_rect = child_ui.min_rect();
        final_child_rect.set_width(width);
        self.allocate_rect(final_child_rect, Sense::hover());
    }
}

impl OverlayState {
    pub fn new() -> OverlayState {
        let ctx = egui::Context::default();

        // Add our custom fonts
        let mut fonts = FontDefinitions::default();
        fonts.font_data.insert(
            "inter".to_string(),
            Arc::new(FontData::from_static(include_bytes!(
                "../../files/fonts/Inter-Regular.ttf"
            ))),
        );
        fonts
            .families
            .entry(egui::FontFamily::Proportional)
            .or_default()
            .insert(0, "inter".to_string());
        ctx.set_fonts(fonts);

        let mut style_arc = ctx.style();
        let style = Arc::make_mut(&mut style_arc);
        // Make windows transparent
        style.visuals.window_fill = style.visuals.window_fill.gamma_multiply(0.7);
        // Don't want select/copy on text labels
        style.interaction.selectable_labels = false;

        // Increase default font sizes a bit.
        // 16.0 seems to give a size that roughly matches with the smallest text size BW uses.
        let text_styles = [
            (TextStyle::Small, 12.0),
            (TextStyle::Body, 16.0),
            (TextStyle::Button, 16.0),
            (TextStyle::Monospace, 16.0),
        ];
        for &(ref text_style, size) in &text_styles {
            if let Some(font) = style.text_styles.get_mut(text_style) {
                font.size = size;
            }
        }
        ctx.set_style(style_arc);
        OverlayState {
            ctx,
            start_time: Instant::now(),
            ui_active: false,
            ui_rects: Vec::new(),
            events: Vec::new(),
            production: ProductionState::new(),
            replay_panels: ReplayPanelState {
                hotkeys_active: false, // Will be set true if replay / obs at step()
                show_statistics: true,
                show_production: true,
                show_console: true,
            },
            out_state: OutState {
                replay_visions: 0,
                select_unit: None,
                show_hide_control: None,
                show_hide_graphic_layer: None,
                show_console: true,
            },
            captured_mouse_down: [false; 2],
            mouse_down: [false; 2],
            window_size: (100, 100),
            screen_size: (100, 100),
            last_mouse_pos: ((0, 0), Pos2 { x: 0.0, y: 0.0 }),
            replay_ui_values: ReplayUiValues {
                name_width: 140.0,
                resource_width: 80.0,
                supply_width: 80.0,
                workers_width: 40.0,
                apm_width: 40.0,
                production_pos: (10.0, 100.0),
                production_image_size: 40.0,
                production_max: 16,
                statbtn_dialog_offset: (0, 0),
            },
            player_vision_was_auto_disabled: [false; 8],
            replay_start_handled: false,
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
            draw_layer: if cfg!(debug_assertions) { 26 } else { 21 },
            network_debug_state: network_manager::DebugState::new(),
            network_debug_info: NetworkDebugInfo::new(),
            dialog_debug_inspect_children: false,
        }
    }

    pub fn step(
        &mut self,
        bw: &BwVars,
        apm: Option<&ApmStats>,
        screen_size: (u32, u32),
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
        self.screen_size = screen_size;
        let screen_rect = Rect {
            min: Pos2 { x: 0.0, y: 0.0 },
            max: Pos2 {
                x: screen_size.0 as f32,
                y: screen_size.1 as f32,
            },
        };
        let time = self.start_time.elapsed().as_secs_f64();
        let events = mem::take(&mut self.events);
        let focused = true;
        let input = egui::RawInput {
            screen_rect: Some(screen_rect),
            // BW doesn't guarantee texture larger than 2048 pixels working
            // (But it depends on user's system)
            max_texture_side: Some(2048),
            time: Some(time),
            predicted_dt: 1.0 / 60.0,
            modifiers: current_egui_modifiers(),
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
            show_console: self.replay_panels.show_console,
        };
        let chat_textbox_open = bw::iter_dialogs(bw.first_dialog)
            .find(|x| x.as_control().string() == "TextBox")
            .and_then(|chat_dlg| chat_dlg.children().find(|x| x.id() == 7))
            .map(|entry_textbox_ctrl| !entry_textbox_ctrl.is_hidden())
            .unwrap_or(false);
        self.replay_panels.hotkeys_active =
            bw.is_replay_or_obs && self.ui_active && !chat_textbox_open;
        let output = ctx.run(input, |ctx| {
            if bw.is_replay_or_obs {
                self.add_replay_ui(bw, apm, ctx);
            }
            let debug = cfg!(debug_assertions);
            if debug {
                self.add_debug_ui(bw, ctx);
            }
        });
        let ui_primitives = self.ctx.tessellate(output.shapes, pixels_per_point);
        let mut primitives = Vec::with_capacity(8);
        if bw.is_replay && self.replay_panels.show_console {
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
            show_console: self.out_state.show_console,
            statbtn_dialog_offset: self.replay_ui_values.statbtn_dialog_offset,
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
            .default_pos((0.0, 0.0))
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
                (&mut v.name_width, "Name"),
                (&mut v.resource_width, "Resources"),
                (&mut v.supply_width, "Supply"),
                (&mut v.workers_width, "Workers"),
                (&mut v.apm_width, "APM"),
                (&mut v.production_pos.0, "Production X"),
                (&mut v.production_pos.1, "Production Y"),
                (&mut v.production_image_size, "Production size"),
            ] {
                ui.add(Slider::new(var, 0.0..=200.0).text(text));
            }
            for (var, text) in [
                (&mut v.statbtn_dialog_offset.0, "Statbtn dialog X"),
                (&mut v.statbtn_dialog_offset.1, "Statbtn dialog Y"),
            ] {
                ui.add(Slider::new(var, -100i32..=100).text(text));
            }
            for (var, text) in [(&mut v.production_max, "Production max")] {
                ui.add(Slider::new(var, 0u32..=50).text(text));
            }
        });
        ui.collapsing("Network", |ui| {
            if let Some((values, time)) = self.network_debug_info.get() {
                values.draw(ui, &mut self.network_debug_state);
                let msg = format!("Updated {}ms ago", time.as_millis());
                ui.label(egui::RichText::new(msg).size(18.0));
            }
        });
        ui.collapsing("BW Dialogs", |ui| {
            self.dialog_debug_ui(bw, ui);
        });
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

    fn add_replay_ui(&mut self, bw: &BwVars, apm: Option<&ApmStats>, ctx: &egui::Context) {
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
        if self.replay_panels.show_statistics {
            self.add_replay_statistics(bw, apm, ctx);
        }
        self.update_replay_production(bw);
        if self.replay_panels.show_production {
            self.add_production_ui(bw, ctx);
        }
    }

    fn add_replay_statistics(&mut self, bw: &BwVars, apm: Option<&ApmStats>, ctx: &egui::Context) {
        let res = egui::Window::new("Replay_Resources")
            .anchor(Align2::RIGHT_TOP, Vec2 { x: -10.0, y: 10.0 })
            .movable(false)
            .resizable(false)
            .title_bar(false)
            .show(ctx, |ui| {
                // Add separators between teams
                // So before first player of team but not before first player of all.
                let mut players_shown = 0;
                let mut team_players_shown = 0;
                let mut prev_team = 0;
                #[allow(clippy::explicit_counter_loop)]
                for (team, player_id) in replay_players_by_team(bw) {
                    // Skip players with no units -- assuming they're UMS map observers.
                    // UMS map with triggers can have players sometimes be
                    // without units until triggers let them play, but probably this
                    // won't be too relevant.
                    // But show all players in team games even though units are owned by one
                    // of them.
                    if !player_has_units(bw, player_id) && !bw.is_team_game {
                        // But if we have player's vision enabled (Can be done through
                        // vision button above minimap / player having had units before),
                        // show player's name so that the user (hopefully) realizes that
                        // they provide vision.
                        if !has_player_vision(bw, player_id) {
                            continue;
                        }
                    }
                    if team != prev_team {
                        prev_team = team;
                        team_players_shown = 0;
                    }
                    let info = unsafe {
                        let player = bw.players.add(player_id as usize);
                        player_resources_info(bw, player, player_id, apm)
                    };
                    if players_shown != 0 && team_players_shown == 0 {
                        ui.scope(|ui| {
                            // Separators seem hard to see with 1.0 default
                            // stroke width.
                            let stroke =
                                &mut ui.style_mut().visuals.widgets.noninteractive.bg_stroke;
                            stroke.width = 2.0;
                            ui.separator();
                        });
                    }
                    let id = Id::new(("ReplayPlayerInfo", player_id));
                    let response = self.add_player_info(ui, id, &info);
                    if response.clicked() && player_id < 8 {
                        let bit = 1u8 << player_id;
                        let mask = unsafe { team_vision_mask(bw, player_id) };
                        // This seems to be enough.
                        // BW itself also writes non-replay player visions and exploration
                        // but they seem to be ignored anyway / wouldn't work as
                        // expected if they were read.
                        if bw.replay_visions & bit != 0 {
                            self.out_state.replay_visions &= !mask;
                        } else {
                            self.out_state.replay_visions |= mask;
                        }
                        if let Some(val) = self
                            .player_vision_was_auto_disabled
                            .get_mut(player_id as usize)
                        {
                            *val = false;
                        }
                    }
                    players_shown += 1;
                    team_players_shown += 1;
                }
            });
        self.add_ui_rect(&res);
    }

    fn add_player_info(&self, ui: &mut egui::Ui, id: Id, info: &PlayerInfo) -> Response {
        let size = Vec2 { x: 300.0, y: 24.0 };
        ui.allocate_ui_with_layout(size, Layout::left_to_right(Align::Center), |ui| {
            let ReplayUiValues {
                name_width,
                resource_width,
                supply_width,
                workers_width,
                apm_width,
                ..
            } = self.replay_ui_values;

            ui.with_fixed_width(name_width, |ui| {
                if !info.vision {
                    let x = egui::RichText::new("❌").color(Color32::RED);
                    ui.add(Label::new(x));
                }
                let text = egui::RichText::new(&*info.name).color(info.color);
                ui.add(Label::new(text));
            });

            let mineral_icon = Texture::StatRes(0);
            info.add_icon_text(ui, mineral_icon, &info.minerals.to_string(), resource_width);
            let gas_icon = Texture::StatRes(1 + info.race.min(2u8) as u16);
            info.add_icon_text(ui, gas_icon, &info.gas.to_string(), resource_width);

            let worker_icon = Texture::CmdIcon(match info.race {
                0 => bw_dat::unit::DRONE.0,
                1 => bw_dat::unit::SCV.0,
                _ => bw_dat::unit::PROBE.0,
            });
            info.add_colored_icon_text(
                ui,
                worker_icon,
                &info.workers.to_string(),
                workers_width,
                Color32::YELLOW,
            );

            // TODO Could add other races if player has supply for them?
            // But then each PlayerInfo render should agree on how many race supplies are drawn
            // to keep things on a grid.
            let (current, max) = info
                .supplies
                .get(info.race as usize)
                .copied()
                .unwrap_or((0, 0));
            // Supply text is slightly more complex as part of it is colored red when
            // supply blocked.
            let part1 = format!("{current}");
            let part2 = format!(" / {max}");
            // Didn't see any nice function to apply all style font overrides,
            // but as long as those don't exist this should match other text.
            let font_id = egui::style::FontSelection::Default.resolve(ui.style());
            let strong_color = ui.visuals().strong_text_color();
            let color = if current > max {
                Color32::RED
            } else {
                strong_color
            };
            let mut text = egui::text::LayoutJob::simple_singleline(part1, font_id.clone(), color);
            text.append(
                &part2,
                0.0,
                egui::TextFormat {
                    font_id,
                    color: strong_color,
                    ..Default::default()
                },
            );
            let supply_icon = Texture::StatRes(4 + info.race.min(2u8) as u16);
            info.add_colored_icon_complex_text(
                ui,
                supply_icon,
                text.into(),
                supply_width,
                Color32::WHITE,
            );

            let label = Label::new(egui::RichText::new("APM "));
            ui.add(label);
            let label = Label::new(egui::RichText::new(info.apm.to_string()).strong());
            ui.add_fixed_width(label, apm_width);
            ui.interact(ui.min_rect(), id, Sense::click())
        })
        .inner
    }

    /// Adds UI rect (Making the area interactable by user) if it was decided that
    /// no higher-priority BW menus are active.
    fn add_ui_rect<T>(&mut self, response: &Option<egui::InnerResponse<T>>) {
        if self.ui_active {
            self.force_add_ui_rect(response, false);
        }
    }

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
    pub fn decide_cursor_type(&self) -> Option<u32> {
        if self.mouse_down != [false, false] && self.captured_mouse_down == [false, false] {
            // Mouse is down but not captured by us, don't modify cursor even
            // if it would be on top of overlay.
            // (Not really sure how the conditional should be with the two separate mouse buttons)
            return None;
        }
        // Otherwise if the cursor is on the overlays, return 0 for regular pointer.
        let mouse_on_ui = self
            .ui_rects
            .iter()
            .any(|rect| rect.area.contains(self.last_mouse_pos.1));
        if mouse_on_ui {
            return Some(0);
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
                        return None;
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
                        return None;
                    }
                    // Scroll amount seems to be fine without any extra scaling
                    let amount = ((wparam >> 16) as i16) as f32;
                    let modifiers = current_egui_modifiers();
                    self.events.push(Event::MouseWheel {
                        unit: egui::MouseWheelUnit::Point,
                        delta: egui::vec2(0.0, amount),
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
                    if let Some(key) = vkey_to_egui_key(vkey) {
                        if !is_syskey && self.ctx.wants_keyboard_input() {
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
                        if pressed && self.check_replay_hotkey(&modifiers, key) {
                            return Some(0);
                        }
                    }
                    None
                }
                WM_CHAR => {
                    if !self.ctx.wants_keyboard_input() {
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

    fn check_replay_hotkey(&mut self, _modifiers: &egui::Modifiers, key: Key) -> bool {
        let panels = &mut self.replay_panels;
        if panels.hotkeys_active {
            match key {
                Key::A => {
                    // Show if any were hidden, else hide
                    let show =
                        !panels.show_statistics || !panels.show_production || !panels.show_console;
                    panels.show_statistics = show;
                    panels.show_production = show;
                    panels.show_console = show;
                    return true;
                }
                Key::F => {
                    panels.show_production = !panels.show_production;
                    return true;
                }
                Key::W => {
                    panels.show_console = !panels.show_console;
                    return true;
                }
                Key::E => {
                    panels.show_statistics = !panels.show_statistics;
                    return true;
                }
                _ => (),
            }
        }
        false
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

impl NetworkDebugInfo {
    pub fn new() -> NetworkDebugInfo {
        NetworkDebugInfo {
            current_request: None,
            previous: None,
            previous_time: Instant::now(),
        }
    }

    pub fn get(&mut self) -> Option<(&network_manager::DebugInfo, Duration)> {
        match self.current_request {
            Some(ref cur) => {
                if cur.get().is_some() {
                    self.previous = self.current_request.take();
                    self.previous_time = Instant::now();
                    self.start_request();
                }
            }
            None => {
                self.start_request();
            }
        }
        let result = self.previous.as_ref()?;
        let result = result.get()?;
        Some((result, self.previous_time.elapsed()))
    }

    fn start_request(&mut self) {
        let arc = Arc::new(OnceLock::new());
        self.current_request = Some(arc.clone());
        game_thread::send_game_msg_to_async(GameThreadMessage::DebugInfoRequest(
            game_thread::DebugInfoRequest::Network(arc),
        ));
    }
}

/// Yields active players `(team, player_id)`, ordered by team.
fn replay_players_by_team(bw: &BwVars) -> impl Iterator<Item = (u8, u8)> + use<> {
    // Teams are 1-based, but team 0 is used on games without teams.
    let players = bw.players;
    (0u8..5).flat_map(move |team| {
        (0..8).filter_map(move |player_id| {
            unsafe {
                let player = players.add(player_id as usize);
                if (*player).team != team {
                    return None;
                }
                // Show only human / computer player types
                let is_active = matches!((*player).player_type, 1 | 2);
                if !is_active {
                    return None;
                }
                Some((team, player_id))
            }
        })
    })
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

struct PlayerInfo {
    name: Cow<'static, str>,
    color: Color32,
    race: u8,
    minerals: u32,
    gas: u32,
    supplies: [(u32, u32); 3],
    workers: u32,
    apm: u32,
    vision: bool,
}

impl PlayerInfo {
    fn add_icon_text(&self, ui: &mut egui::Ui, icon: Texture, text: &str, width: f32) {
        self.add_colored_icon_text(ui, icon, text, width, Color32::WHITE)
    }

    fn add_colored_icon_text(
        &self,
        ui: &mut egui::Ui,
        icon: Texture,
        text: &str,
        width: f32,
        color: Color32,
    ) {
        let text = egui::RichText::new(text).strong();
        self.add_colored_icon_complex_text(ui, icon, text.into(), width, color)
    }

    fn add_colored_icon_complex_text(
        &self,
        ui: &mut egui::Ui,
        icon: Texture,
        text: WidgetText,
        width: f32,
        color: Color32,
    ) {
        let image = egui::Image::new(SizedTexture::new(
            TextureId::User(icon.to_egui_id()),
            (24.0, 24.0),
        ))
        .tint(color);
        ui.add(image);
        let label = Label::new(text);
        ui.add_fixed_width(label, width);
    }
}

unsafe fn player_resources_info(
    bw: &BwVars,
    player: *mut bw::Player,
    player_id: u8,
    apm: Option<&ApmStats>,
) -> PlayerInfo {
    unsafe {
        let game = bw.game;
        let get_supplies = |race| {
            let used = game.supply_used(player_id, race);
            let available = game
                .supply_provided(player_id, race)
                .min(game.supply_max(player_id, race));
            // Supply is internally twice the shown value (as zergling / scourge
            // takes 0.5 supply per unit), used supply has to be rounded up
            // when displayed.
            (used.wrapping_add(1) / 2, available / 2)
        };
        let color = bw::player_color(
            game,
            bw.main_palette,
            bw.use_rgb_colors,
            bw.rgb_colors,
            player_id,
        );
        let supplies = [
            get_supplies(Race::Zerg),
            get_supplies(Race::Terran),
            get_supplies(Race::Protoss),
        ];
        let workers = [bw_dat::unit::SCV, bw_dat::unit::PROBE, bw_dat::unit::DRONE]
            .iter()
            .map(|&unit| game.completed_count(player_id, unit))
            .sum::<u32>();
        let mut name = bw::player_name(player);
        if name.is_empty() {
            name = format!("Player {}", player_id + 1).into();
        }
        let mut race = (*player).race;
        if race > 2 {
            race = 0;
        }
        let vision = has_player_vision(bw, player_id);
        PlayerInfo {
            name,
            color: Color32::from_rgb(color[0], color[1], color[2]),
            race,
            minerals: game.minerals(player_id),
            gas: game.gas(player_id),
            supplies,
            workers,
            apm: apm.map(|x| x.player_recent_apm(player_id)).unwrap_or(0),
            vision,
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
