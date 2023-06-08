mod production;

use std::borrow::Cow;
use std::mem;
use std::sync::Arc;
use std::time::Instant;

use egui::{
    Align, Align2, Color32, Event, Id, Label, Layout, Key, PointerButton, Pos2, Rect, Response,
    Sense, Slider, TextureId, Vec2, Widget,
};
use egui::style::{TextStyle};
use winapi::shared::windef::{HWND, POINT};

use bw_dat::{Unit, Race};

use crate::bw;
use crate::bw::apm_stats::ApmStats;

use self::production::{ProductionState};

pub struct OverlayState {
    ctx: egui::Context,
    start_time: Instant,
    ui_rects: Vec<Rect>,
    events: Vec<Event>,
    production: ProductionState,
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
}

/// State that will be in StepOutput; mutated through &mut self
/// during child functions of step()
struct OutState {
    replay_visions: u8,
    select_unit: Option<Unit>
}

pub struct StepOutput {
    pub textures_delta: egui::TexturesDelta,
    pub primitives: Vec<egui::ClippedPrimitive>,
    pub replay_visions: u8,
    pub select_unit: Option<Unit>,
}

/// Bw globals used by OverlayState::step
pub struct BwVars {
    pub is_replay_or_obs: bool,
    pub game: bw_dat::Game,
    pub players: *mut bw::Player,
    pub main_palette: *mut u8,
    pub rgb_colors: *mut [[f32; 4]; 8],
    pub use_rgb_colors: u8,
    pub replay_visions: u8,
    pub active_units: bw::unit::UnitIterator,
}

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
            TEXTURE_FIRST_STATRES ..= TEXTURE_LAST_STATRES => {
                Texture::StatRes((val - TEXTURE_FIRST_STATRES) as u16)
            }
            TEXTURE_FIRST_CMDICON ..= TEXTURE_LAST_CMDICON => {
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
        self.with_fixed_width(width, |ui| { ui.add(widget); })
    }

    fn with_fixed_width<F: FnOnce(&mut Self)>(&mut self, width: f32, add_widgets: F) {
        let child_rect = self.cursor();
        let mut child_ui = self.child_ui(child_rect, *self.layout());

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
        let mut style_arc = ctx.style();
        let style = Arc::make_mut(&mut style_arc);
        // Make windows transparent
        style.visuals.window_fill = style.visuals.window_fill.gamma_multiply(0.5);
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
            ui_rects: Vec::new(),
            events: Vec::new(),
            production: ProductionState::new(),
            out_state: OutState {
                replay_visions: 0,
                select_unit: None,
            },
            captured_mouse_down: [false; 2],
            mouse_down: [false; 2],
            window_size: (100, 100),
            screen_size: (100, 100),
            last_mouse_pos: ((0, 0), Pos2 { x: 0.0, y: 0.0}),
            replay_ui_values: ReplayUiValues {
                name_width: 140.0,
                resource_width: 80.0,
                supply_width: 80.0,
                workers_width: 40.0,
                apm_width: 40.0,
                production_pos: (10.0, 100.0),
                production_image_size: 40.0,
                production_max: 16,
            },
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
            } else {
                if input < rounded {
                    rounded - 1.0
                } else {
                    rounded + 1.0
                }
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
        let events = mem::replace(&mut self.events, Vec::new());
        let has_focus = true;
        let input = egui::RawInput {
            screen_rect: Some(screen_rect),
            pixels_per_point: Some(pixels_per_point),
            // BW doesn't guarantee texture larger than 2048 pixels working
            // (But it depends on user's system)
            max_texture_side: Some(2048),
            time: Some(time),
            predicted_dt: 1.0 / 60.0,
            modifiers: current_egui_modifiers(),
            events,
            hovered_files: Vec::new(),
            dropped_files: Vec::new(),
            has_focus,
        };
        self.ui_rects.clear();
        let ctx = self.ctx.clone();
        self.out_state = OutState {
            replay_visions: bw.replay_visions,
            select_unit: None,
        };
        let output = ctx.run(input, |ctx| {
            if bw.is_replay_or_obs {
                self.add_replay_ui(bw, apm, ctx);
            }
            let debug = cfg!(debug_assertions);
            if debug {
                self.add_debug_ui(ctx);
            }
        });
        StepOutput {
            textures_delta: output.textures_delta,
            primitives: self.ctx.tessellate(output.shapes),
            replay_visions: self.out_state.replay_visions,
            select_unit: self.out_state.select_unit,
        }
    }

    fn add_debug_ui(&mut self, ctx: &egui::Context) {
        let res = egui::Window::new("Debug")
            .default_pos((0.0, 0.0))
            .default_open(false)
            .movable(true)
            .show(ctx, |ui| {
                ui.collapsing("Egui settings", |ui| {
                    egui::ScrollArea::vertical()
                        .max_height(self.screen_size.1 as f32 * 0.8)
                        .show(ui, |ui| {
                            ctx.settings_ui(ui);
                        });
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
                        (&mut v.production_max, "Production max"),
                    ] {
                        ui.add(Slider::new(var, 0u32..=50).text(text));
                    }
                });
                let msg = format!("Windows mouse {}, {},\n    egui {}, {}",
                    self.last_mouse_pos.0.0,
                    self.last_mouse_pos.0.1,
                    self.last_mouse_pos.1.x,
                    self.last_mouse_pos.1.y,
                );
                ui.label(egui::RichText::new(msg).size(18.0));
                let msg = format!("Windows size {}, {}, egui size {}, {}",
                    self.window_size.0,
                    self.window_size.1,
                    self.screen_size.0,
                    self.screen_size.1,
                );
                ui.label(egui::RichText::new(msg).size(18.0));
                let modifiers = current_egui_modifiers();
                let msg = format!("Ctrl {}, Alt {}, shift {}",
                    modifiers.ctrl,
                    modifiers.alt,
                    modifiers.shift,
                );
                ui.label(egui::RichText::new(msg).size(18.0));
            });
        self.add_ui_rect(&res);
    }

    fn add_replay_ui(&mut self, bw: &BwVars, apm: Option<&ApmStats>, ctx: &egui::Context) {
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
                for (team, player_id) in replay_players_by_team(bw) {
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
                            let stroke = &mut ui.style_mut()
                                .visuals
                                .widgets
                                .noninteractive
                                .bg_stroke;
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
                    }
                    players_shown += 1;
                    team_players_shown += 1;
                }
            });
        self.add_ui_rect(&res);
        self.update_replay_production(bw);
        self.add_production_ui(bw, ctx);
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
                2 | _ => bw_dat::unit::PROBE.0,
            });
            info.add_icon_text_color(
                ui,
                worker_icon,
                &info.workers.to_string(),
                workers_width,
                Color32::YELLOW,
            );

            // TODO Could add other races if player has supply for them?
            // But then each PlayerInfo render should agree on how many race supplies are drawn
            // to keep things on a grid.
            let (current, max) = info.supplies.get(info.race as usize)
                .copied()
                .unwrap_or((0, 0));
            let supply_text = format!("{} / {}", current, max);
            let supply_icon = Texture::StatRes(4 + info.race.min(2u8) as u16);
            info.add_icon_text(ui, supply_icon, &supply_text, supply_width);

            let label = egui::Label::new(egui::RichText::new("APM ").strong());
            ui.add(label);
            let label = egui::Label::new(info.apm.to_string());
            ui.add_fixed_width(label, apm_width);
            ui.interact(ui.min_rect(), id, Sense::click())
        }).inner
    }

    fn add_ui_rect<T>(&mut self, response: &Option<egui::InnerResponse<T>>) {
        if let Some(res) = response {
            self.ui_rects.push(res.response.rect);
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
        let mouse_on_ui = self.ui_rects.iter().any(|rect| {
            rect.contains(self.last_mouse_pos.1)
        });
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
                    self.ui_rects.iter().any(|x| x.contains(pos))
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
                    }
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
                let handle = self.ui_rects.iter().any(|x| x.contains(pos));
                if !handle {
                    return None;
                }
                // Scroll amount seems to be fine without any extra scaling
                let amount = ((wparam >> 16) as i16) as f32;
                self.events.push(Event::Scroll(Vec2 { x: 0.0, y: amount }));
                Some(0)
            }
            WM_KEYDOWN | WM_KEYUP => {
                if !self.ctx.wants_keyboard_input() {
                    return None;
                }
                let vkey = wparam as i32;
                if let Some(key) = vkey_to_egui_key(vkey) {
                    let modifiers = current_egui_modifiers();
                    let pressed = msg == WM_KEYDOWN;
                    self.events.push(Event::Key {
                        key,
                        pressed,
                        // Could get repeat count from param, but egui docs say that
                        // it will be automatically done anyway by egui.
                        repeat: false,
                        modifiers,
                    });
                }
                Some(0)
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
            let y_offset = window_h as f32 * (1.0 - ratio) * 0.5;
            let y_div = window_h * ratio;
            Pos2 {
                x: x as f32 / window_w * screen_w,
                y: (y as f32 - y_offset) / y_div * screen_h,
            }
        }
    }
}

/// Yields active players `(team, player_id)`, ordered by team.
fn replay_players_by_team(bw: &BwVars) -> impl Iterator<Item = (u8, u8)> {
    // Teams are 1-based, but team 0 is used on games without teams.
    let players = bw.players;
    (0u8..5)
        .flat_map(move |team| {
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
    fn add_icon_text(
        &self,
        ui: &mut egui::Ui,
        icon: Texture,
        text: &str,
        width: f32,
    ) {
        self.add_icon_text_color(ui, icon, text, width, Color32::WHITE)
    }

    fn add_icon_text_color(
        &self,
        ui: &mut egui::Ui,
        icon: Texture,
        text: &str,
        width: f32,
        color: Color32,
    ) {
        let image = egui::Image::new(TextureId::User(icon.to_egui_id()), (24.0, 24.0))
            .tint(color);
        ui.add(image);
        let label = egui::Label::new(text);
        ui.add_fixed_width(label, width);
    }
}

unsafe fn player_resources_info(
    bw: &BwVars,
    player: *mut bw::Player,
    player_id: u8,
    apm: Option<&ApmStats>,
) -> PlayerInfo {
    let game = bw.game;
    let get_supplies = |race| {
        let used = game.supply_used(player_id, race);
        let available = game.supply_provided(player_id, race)
            .min(game.supply_max(player_id, race));
        // Supply is internally twice the shown value (as zergling / scourge
        // takes 0.5 supply per unit), used supply has to be rounded up
        // when displayed.
        (used.wrapping_add(1) / 2, available / 2)
    };
    let color =
        bw::player_color(game, bw.main_palette, bw.use_rgb_colors, bw.rgb_colors, player_id);
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
    let vision = match 1u8.checked_shl(player_id as u32) {
        Some(bit) => bw.replay_visions & bit != 0,
        None => true,
    };
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

/// Returns mask containing all player bits that this player has given/receives vision to,
/// as long as all players in the group share vision both ways.
/// If there is one-way vision somewhere, returns just `1 << player_id`
///
/// So that entire team's vision is toggled at once.
unsafe fn team_vision_mask(bw: &BwVars, player_id: u8) -> u8 {
    if player_id >= 8 {
        return 0;
    }
    let default_value = 1u8 << player_id;
    let mask = (**bw.game).visions[player_id as usize] as u8;
    for i in 0..8 {
        if mask & (1 << i) != 0 {
            if (**bw.game).visions[i] != mask as u32 {
                return default_value;
            }
        }
    }
    mask
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
        VK_ADD => PlusEquals,
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
