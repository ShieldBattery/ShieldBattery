//! Records the local player's cursor and camera during a live game, and shows a recorded player's
//! perspective (camera, cursor, clicks, selection) while watching a replay.
//!
//! Positions pass through three spaces:
//! - UI space: BW's dialog coordinates, which the mouse position is reported in. It is 480 units
//!   tall and `480 * aspect ratio` wide whatever the resolution, so a recording made at 2560x1440
//!   and one made at 1920x1080 agree.
//! - Map pixels: where on the map something is.
//! - Render target pixels: what the overlay draws in.
//!
//! The cursor over the game view is shown at the same map position for the viewer, which holds
//! across resolutions, aspect ratios and zoom levels. Over UI it is placed relative to the edge of
//! the screen the UI under it is anchored to.

use std::sync::atomic::Ordering;

use libc::c_void;

use egui::Color32;

use crate::bw::{self, Bw, players::StormPlayerId};
use crate::first_person::track::{CursorRegion, TrackOwner, View, Viewport};
use crate::first_person::{self, LiveView, PlaybackFrame};
use crate::game_thread;

use super::draw_overlay::{FirstPersonView, PerspectiveFrame, RecordedPerspective};
use super::thiscall::Thiscall;
use super::{BwCursorType, BwScr, SendPtr, Value};

/// The game's functions for hiding and showing its cursor, which the viewer's cursor uses to get out
/// of the way of a replay player's.
pub struct GameCursorVisibility {
    pub hide: unsafe extern "C" fn(),
    pub show: unsafe extern "C" fn(),
}

/// Engine pieces for recording the cursor. Missing pieces only make recordings less detailed, with
/// the mouse position functions being the one thing recording can't do without.
pub struct FirstPersonEngine {
    pub get_mouse_x: unsafe extern "C" fn() -> i32,
    pub get_mouse_y: unsafe extern "C" fn() -> i32,
    pub is_outside_game_screen: Option<unsafe extern "C" fn(i32, i32) -> u8>,
    pub is_selecting: Option<Value<u8>>,
    pub select_start: Option<(Value<u16>, Value<u16>)>,
}

/// Command ids of the right click and targeted order commands, the original ones with 16-bit unit
/// ids and the extended ones with 32-bit ids.
const RIGHT_CLICK: u8 = 0x14;
const TARGETED_ORDER: u8 = 0x15;
const RIGHT_CLICK_EXTENDED: u8 = 0x60;
const TARGETED_ORDER_EXTENDED: u8 = 0x61;

/// The blink a click gives its target, as the game's own click handling sets it.
const SELECTION_FLASH_TIMER: u32 = 0x1f;

/// Height of BW's UI coordinate space.
const UI_HEIGHT: f32 = 480.0;

/// The player's view is outlined for the viewer when its edges are this many render pixels or
/// more away from the viewer's own.
const VIEW_OUTLINE_MIN_DIFFERENCE: f32 = 8.0;

/// The perspective shown on a drawn frame of a replay and the replay time to show it at.
pub struct FollowedFrame {
    frame: PlaybackFrame,
}

impl FollowedFrame {
    /// Index into [`first_person::replay_tracks`].
    pub fn track_index(&self) -> usize {
        self.frame.track_index
    }
}

impl BwScr {
    unsafe fn game_speed(&self) -> u8 {
        unsafe {
            let data = self.game_data();
            if data.is_null() {
                6
            } else {
                (*data).game_speed
            }
        }
    }

    /// Render target pixels per map pixel for a render target `render_width` wide: the game view
    /// spans the whole render target, `game_screen_width_bwpx` map pixels across.
    unsafe fn first_person_zoom(&self, render_width: u32) -> Option<f32> {
        unsafe {
            let map_width = self.game_screen_width_bwpx.resolve();
            if map_width == 0 || render_width == 0 {
                None
            } else {
                Some(render_width as f32 / map_width as f32)
            }
        }
    }

    /// Records what the local player sees this drawn frame of a live game, starting the recording
    /// on the first frame of the game.
    pub(super) unsafe fn first_person_record(&self, render_size: (u32, u32)) {
        unsafe {
            let Some(engine) = &self.first_person else {
                return;
            };
            let game = self.game();
            if game.is_null() || render_size.1 == 0 {
                return;
            }
            let Some(zoom) = self.first_person_zoom(render_size.0) else {
                return;
            };
            if !first_person::is_recording() {
                let Some(user) = game_thread::local_user_id() else {
                    return;
                };
                let player = self.local_player_id.resolve();
                let owner = TrackOwner {
                    sb_user_id: user.0,
                    storm_id: self.local_storm_id.resolve() as u8,
                    bw_player_id: if player < 8 {
                        player as u8
                    } else {
                        first_person::track::UNKNOWN_PLAYER
                    },
                };
                first_person::start_recording(owner, self.game_speed());
            }
            let x = (engine.get_mouse_x)();
            let y = (engine.get_mouse_y)();
            let region = match engine.is_outside_game_screen {
                Some(is_outside) => {
                    if is_outside(x, y) != 0 {
                        CursorRegion::Ui
                    } else {
                        CursorRegion::Game
                    }
                }
                None => {
                    let ratio = self
                        .game_screen_height_ratio
                        .as_ref()
                        .map(|r| r.resolve())
                        .unwrap_or(0.8);
                    if y as f32 > UI_HEIGHT * ratio {
                        CursorRegion::Ui
                    } else {
                        CursorRegion::Game
                    }
                }
            };
            let drag_start = match (&engine.is_selecting, &engine.select_start) {
                (Some(selecting), Some((start_x, start_y))) if selecting.resolve() != 0 => {
                    Some((start_x.resolve() as i16, start_y.resolve() as i16))
                }
                _ => None,
            };
            let cursor_type = if drag_start.is_some() {
                BwCursorType::Drag as u8
            } else {
                self.last_cursor_type.load(Ordering::Relaxed)
            };
            first_person::record(LiveView {
                frame: (*game).frame_count,
                cursor: (clamp_i16(x), clamp_i16(y)),
                screen: (
                    self.screen_x.resolve().min(u16::MAX as u32) as u16,
                    self.screen_y.resolve().min(u16::MAX as u32) as u16,
                ),
                region,
                cursor_type,
                viewport: Viewport {
                    render_width: render_size.0.min(u16::MAX as u32) as u16,
                    render_height: render_size.1.min(u16::MAX as u32) as u16,
                    zoom,
                },
                drag_start,
            });
        }
    }

    /// Moves the camera to the shown player's camera, unless the viewer has taken it over.
    /// Called before the replay frame is drawn so the frame shows the moved camera.
    pub(super) unsafe fn first_person_follow(&self) -> Option<FollowedFrame> {
        unsafe {
            let game = self.game();
            if game.is_null() {
                return None;
            }
            let seeking = self
                .replay_seek_frame
                .as_ref()
                .is_some_and(|seek| seek.resolve() > (*game).frame_count);
            if seeking {
                return None;
            }
            let frame_ms = first_person::frame_ms(self.game_speed());
            let camera = (self.screen_x.resolve(), self.screen_y.resolve());
            let frame = first_person::playback_frame((*game).frame_count, frame_ms, camera)?;
            let followed = FollowedFrame { frame };
            if !followed.frame.follow_camera {
                return Some(followed);
            }
            let Some(view) = followed.frame.track.view_at(followed.frame.time) else {
                return Some(followed);
            };
            let Some(viewport) = view.viewport.filter(|v| v.zoom > 0.0) else {
                return Some(followed);
            };
            // Match the centers of the two cameras' views; the viewer's view may be a different
            // size or shape than the player's.
            let target = (self.get_render_target)(1);
            if target.is_null() {
                return Some(followed);
            }
            let Some(zoom) = self.first_person_zoom((*target).width) else {
                return Some(followed);
            };
            let viewer_w = (*target).width as f32 / zoom;
            let viewer_h = (*target).height as f32 / zoom;
            let (player_w, player_h) = player_view_size(&viewport);
            let x = (view.screen.0 + (player_w - viewer_w) / 2.0).max(0.0);
            let y = (view.screen.1 + (player_h - viewer_h) / 2.0).max(0.0);
            (self.move_screen)(x as u32, y as u32);
            first_person::camera_moved_to((self.screen_x.resolve(), self.screen_y.resolve()));
            Some(followed)
        }
    }

    /// The recorded perspectives of the replay being watched as of the frame just drawn, with
    /// `followed` as it should be drawn over it, in render target pixels of `render_size`. `None`
    /// for a replay that recorded none.
    pub(super) unsafe fn first_person_frame(
        &self,
        followed: Option<FollowedFrame>,
        render_size: (u32, u32),
    ) -> Option<PerspectiveFrame> {
        unsafe {
            let recorded = self.first_person_recorded();
            if recorded.is_empty() {
                return None;
            }
            let view = followed.and_then(|followed| {
                let color = recorded.get(followed.track_index())?.color;
                let view = self.first_person_view(&followed, color, render_size)?;
                Some((view, render_size))
            });
            Some(PerspectiveFrame { recorded, view })
        }
    }

    /// The recorded perspectives of the replay being watched, named and colored like their
    /// players.
    unsafe fn first_person_recorded(&self) -> Vec<RecordedPerspective> {
        unsafe {
            let tracks = first_person::replay_tracks();
            if tracks.is_empty() {
                return Vec::new();
            }
            let game = bw_dat::Game::from_ptr(self.game());
            let players = self.players();
            tracks
                .iter()
                .map(|track| {
                    let unique = self.unique_player_for_storm(StormPlayerId(track.owner.storm_id));
                    let player_id = unique.filter(|&i| i < 8);
                    let (name, color) = match unique {
                        Some(i) => {
                            let player = players.add(i as usize);
                            let name = bw::player_name(player).into_owned();
                            let color = bw::player_color(
                                game,
                                self.main_palette.resolve(),
                                self.use_rgb_colors.resolve(),
                                self.rgb_colors.resolve(),
                                i,
                            );
                            (name, Color32::from_rgb(color[0], color[1], color[2]))
                        }
                        None => (format!("Player {}", track.owner.storm_id), Color32::WHITE),
                    };
                    RecordedPerspective {
                        name,
                        color,
                        player_id,
                    }
                })
                .collect()
        }
    }

    /// The shown player's perspective as it should be drawn over the frame just drawn, with
    /// coordinates in render target pixels of `render_size`.
    unsafe fn first_person_view(
        &self,
        followed: &FollowedFrame,
        color: Color32,
        render_size: (u32, u32),
    ) -> Option<FirstPersonView> {
        unsafe {
            let frame = &followed.frame;
            let track = frame.track;
            let view = track.view_at(frame.time)?;
            let viewport = view.viewport.filter(|v| v.zoom > 0.0)?;
            let projection = Projection {
                camera: (
                    self.screen_x.resolve() as f32,
                    self.screen_y.resolve() as f32,
                ),
                zoom: self.first_person_zoom(render_size.0)?,
                render_size: (render_size.0 as f32, render_size.1.max(1) as f32),
            };

            let mut cursor = None;
            let mut drag_rect = None;
            let mut player_view = None;
            if frame.show_cursor {
                let visible = view.focused && !view.grab_panning;
                cursor = visible.then(|| projection.cursor(&view, &viewport));
                drag_rect = view.drag_start.map(|start| {
                    let start = (start.0 as f32, start.1 as f32);
                    (
                        projection.world(ui_to_world(&view, &viewport, start)),
                        projection.world(ui_to_world(&view, &viewport, view.cursor)),
                    )
                });
                player_view = projection.player_view(&view, &viewport);
            }

            Some(FirstPersonView {
                color,
                cursor_scale: self.cursor_scale_factor.resolve(),
                cursor,
                cursor_type: view.cursor_type,
                drag_rect,
                player_view,
            })
        }
    }

    /// Hides the viewer's cursor while it idles over a replay player's perspective, and shows it
    /// again once they use their mouse. Called each drawn frame.
    pub(super) unsafe fn first_person_update_viewer_cursor(&self) {
        unsafe {
            let Some(visibility) = &self.game_cursor_visibility else {
                return;
            };
            let hide = first_person::hide_viewer_cursor();
            if self.viewer_cursor_hidden.swap(hide, Ordering::Relaxed) == hide {
                return;
            }
            debug!(
                "{} the viewer's cursor",
                if hide { "Hiding" } else { "Showing" }
            );
            if hide {
                (visibility.hide)();
            } else if !first_person::viewer_middle_down() {
                // A grab pan the viewer started hides the cursor too, and shows it again when it
                // ends.
                (visibility.show)();
            }
        }
    }

    /// Shows the feedback the player saw for a right click or targeted order of theirs: the clicked
    /// unit's selection circle blinks, or the order marker shows on the ground. Commands carry the
    /// click's position and target, so this comes from the command as it executes.
    pub(super) unsafe fn first_person_command_feedback(
        &self,
        command: &[u8],
        storm_player: StormPlayerId,
    ) {
        unsafe {
            let Some(feedback) = &self.click_feedback else {
                return;
            };
            if !first_person::shows_actions_of(storm_player.0) {
                return;
            }
            let read_u16 = |pos: usize| {
                command
                    .get(pos..pos + 2)
                    .map(|x| u16::from_le_bytes([x[0], x[1]]) as u32)
            };
            let read_u32 = |pos: usize| {
                command
                    .get(pos..pos + 4)
                    .map(|x| u32::from_le_bytes([x[0], x[1], x[2], x[3]]))
            };
            // Right click and targeted order: x, y, then the target's unique id, 16 bits in the
            // original commands and 32 in the extended ones.
            let target = match command.first() {
                Some(&RIGHT_CLICK | &TARGETED_ORDER) => read_u16(5),
                Some(&RIGHT_CLICK_EXTENDED | &TARGETED_ORDER_EXTENDED) => read_u32(5),
                _ => return,
            };
            let (Some(x), Some(y), Some(target)) = (read_u16(1), read_u16(3), target) else {
                return;
            };
            let unit = self
                .unit_array()
                .filter(|_| target != 0)
                .and_then(|units| units.get_by_unique_id(target));
            match unit {
                Some(unit) => {
                    let flash = Thiscall::<unsafe extern "C" fn(*mut c_void, u32)>::foreign(
                        feedback.set_selection_flash_timer.0 as usize,
                    );
                    flash.call2(*unit as *mut c_void, SELECTION_FLASH_TIMER);
                }
                None => {
                    let show = std::mem::transmute::<usize, unsafe extern "C" fn(i32, i32)>(
                        feedback.show_cursor_marker_at.0 as usize,
                    );
                    show(x as i32, y as i32);
                }
            }
        }
    }

    /// Makes the viewer's selection the shown player's whenever the player's selection changes,
    /// so the game shows it the way it shows the viewer's own: selection circles, status panel
    /// and wireframes. Between changes the viewer can select something else.
    pub(super) unsafe fn first_person_mirror_selection(&self, followed: &FollowedFrame) {
        unsafe {
            if !followed.frame.show_actions {
                return;
            }
            let Some(selections) = &self.selection.simulated_selections else {
                return;
            };
            let storm_id = StormPlayerId(followed.frame.track.owner.storm_id);
            let Some(unique) = self.unique_player_for_storm(storm_id).filter(|&x| x < 8) else {
                return;
            };
            let row = selections.resolve().add(unique as usize * 12);
            let units: Vec<*mut bw::Unit> = (0..12)
                .map(|i| *row.add(i))
                .take_while(|unit| !unit.is_null())
                .collect();
            let mut mirrored = self.first_person_mirrored_selection.lock();
            if mirrored.iter().map(|x| x.0).eq(units.iter().copied()) {
                return;
            }
            *mirrored = units.iter().map(|&x| SendPtr(x)).collect();
            self.engine_select(&units);
        }
    }
}

/// Maps map positions and the recording player's UI points onto the viewer's render target.
struct Projection {
    /// Top-left of the viewer's camera, in map pixels.
    camera: (f32, f32),
    /// Viewer's render target pixels per map pixel.
    zoom: f32,
    render_size: (f32, f32),
}

impl Projection {
    fn world(&self, (x, y): (f32, f32)) -> (f32, f32) {
        (
            (x - self.camera.0) * self.zoom,
            (y - self.camera.1) * self.zoom,
        )
    }

    /// Where the player's cursor goes on the viewer's screen: over the game view it points at the
    /// same map position, over UI it sits over the same part of the UI.
    fn cursor(&self, view: &View, viewport: &Viewport) -> (f32, f32) {
        match view.region {
            CursorRegion::Game => self.world(ui_to_world(view, viewport, view.cursor)),
            CursorRegion::Ui => {
                let player_width =
                    UI_HEIGHT * viewport.render_width as f32 / viewport.render_height.max(1) as f32;
                let viewer_width = UI_HEIGHT * self.render_size.0 / self.render_size.1;
                let x = anchor_ui_x(view.cursor.0, player_width, viewer_width);
                let scale = self.render_size.1 / UI_HEIGHT;
                (x * scale, view.cursor.1 * scale)
            }
        }
    }

    /// The corners of the player's view, when it differs enough from the viewer's to be worth
    /// outlining (a different aspect ratio or zoom, or a camera clamped at the map edge).
    fn player_view(&self, view: &View, viewport: &Viewport) -> Option<((f32, f32), (f32, f32))> {
        let (width, height) = player_view_size(viewport);
        let start = self.world(view.screen);
        let end = self.world((view.screen.0 + width, view.screen.1 + height));
        let differs = start.0.abs().max(start.1.abs()) >= VIEW_OUTLINE_MIN_DIFFERENCE
            || (end.0 - self.render_size.0).abs() >= VIEW_OUTLINE_MIN_DIFFERENCE
            || (end.1 - self.render_size.1).abs() >= VIEW_OUTLINE_MIN_DIFFERENCE;
        differs.then_some((start, end))
    }
}

/// Size of the player's view in map pixels.
fn player_view_size(viewport: &Viewport) -> (f32, f32) {
    (
        viewport.render_width as f32 / viewport.zoom,
        viewport.render_height as f32 / viewport.zoom,
    )
}

/// The map position under a point of the recording player's UI space.
fn ui_to_world(view: &View, viewport: &Viewport, point: (f32, f32)) -> (f32, f32) {
    let map_per_ui = viewport.render_height as f32 / UI_HEIGHT / viewport.zoom;
    (
        view.screen.0 + point.0 * map_per_ui,
        view.screen.1 + point.1 * map_per_ui,
    )
}

/// Moves a UI x coordinate from a screen `from_width` UI units wide to one `to_width` wide,
/// keeping its distance from the edge that UI is laid out against: the minimap on the left, the
/// command card on the right, and the console's middle at the center.
fn anchor_ui_x(x: f32, from_width: f32, to_width: f32) -> f32 {
    if x < from_width / 3.0 {
        x
    } else if x > from_width * 2.0 / 3.0 {
        to_width - (from_width - x)
    } else {
        x + (to_width - from_width) / 2.0
    }
}

fn clamp_i16(value: i32) -> i16 {
    value.clamp(i16::MIN as i32, i16::MAX as i32) as i16
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn anchor_ui_x_keeps_edge_distances() {
        // 16:9 recording (853 wide) shown on 4:3 (640 wide).
        assert_eq!(anchor_ui_x(100.0, 853.0, 640.0), 100.0);
        assert_eq!(anchor_ui_x(800.0, 853.0, 640.0), 587.0);
        assert_eq!(anchor_ui_x(426.5, 853.0, 640.0), 320.0);
        // Same width leaves every point where it was.
        for x in [0.0, 200.0, 400.0, 639.0] {
            assert_eq!(anchor_ui_x(x, 640.0, 640.0), x);
        }
    }

    #[test]
    fn ui_to_world_is_resolution_independent() {
        let view = View {
            cursor: (0.0, 0.0),
            screen: (1000.0, 2000.0),
            region: CursorRegion::Game,
            cursor_type: 0,
            viewport: None,
            focused: true,
            drag_start: None,
            grab_panning: false,
        };
        // Both show 854 map pixels across a 16:9 render target.
        let hd = Viewport {
            render_width: 1920,
            render_height: 1080,
            zoom: 1920.0 / 854.0,
        };
        let qhd = Viewport {
            render_width: 2560,
            render_height: 1440,
            zoom: 2560.0 / 854.0,
        };
        let point = (426.0, 240.0);
        let a = ui_to_world(&view, &hd, point);
        let b = ui_to_world(&view, &qhd, point);
        assert!((a.0 - b.0).abs() < 0.01 && (a.1 - b.1).abs() < 0.01);
        // The middle of the UI space is the middle of the 854 x 480 map pixel view.
        assert!((a.0 - 1427.0).abs() < 1.0, "{a:?}");
        assert!((a.1 - 2240.0).abs() < 1.0, "{a:?}");
    }
}
