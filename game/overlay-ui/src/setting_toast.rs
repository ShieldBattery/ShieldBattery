//! A brief notice of a setting the game changed on one of its own keys, such as `Ctrl+M` turning
//! the music off or `Shift+Tab` stepping the color overrides. Those keys say nothing themselves,
//! so without it the player is left to guess from the picture or the sound whether the press
//! landed, and which way. The notice takes no input and leaves on its own.

use egui::{
    Align2, Area, Color32, Context, Frame, Id, Margin, Order, Rect, Shape, Stroke, StrokeKind,
    TextWrapMode, vec2,
};

use crate::colors::BLUE10;
use crate::kit::text::{self, BodyWeight};
use crate::kit::{motion, theme};
use crate::options::{DisplayMode, MinimapColorMode, MinimapTerrain, SettingChange};
use crate::tr;

/// How long the notice stays at rest before it leaves, in seconds.
const HOLD_SECS: f64 = 1.2;

/// How far above the top of the minimap the notice stands, which puts it just over the console
/// where the eye already goes for the game's own state.
const CONSOLE_GAP: f32 = 12.0;

/// How far up from the bottom of the screen the notice stands where the host can't say where the
/// minimap is, as a share of the screen's height: about where the console's top edge is.
const FALLBACK_BOTTOM_FRACTION: f32 = 0.25;

/// The notice's fill: the ambient panels' own blue, let further through so the game stays visible
/// under a notice that only passes by.
const FILL: Color32 = theme::alpha(BLUE10, 0.7);

const TEXT_SIZE: f32 = 17.0;

/// Room around the text beyond an ambient panel's own, so the notice reads as a notice rather
/// than a tooltip.
const MARGIN: Margin = Margin::symmetric(22, 13);

/// The notice on screen, or on its way off.
pub struct SettingToast {
    text: String,
    /// When the notice was first drawn, which is when its hold starts. `None` until then.
    since: Option<f64>,
}

impl SettingToast {
    /// A notice for `change`, or `None` for a setting the game has no key of its own for.
    pub fn for_change(change: SettingChange) -> Option<SettingToast> {
        toast_text(change).map(|text| SettingToast { text, since: None })
    }

    /// Draws the notice over the console, whose top `minimap` marks where the host knows it,
    /// returning whether the notice is still on screen.
    pub fn draw(&mut self, ctx: &Context, minimap: Option<Rect>) -> bool {
        let now = ctx.input(|input| input.time);
        let since = *self.since.get_or_insert(now);
        let remaining = HOLD_SECS - (now - since);
        if remaining > 0.0 {
            ctx.request_repaint_after_secs(remaining as f32);
        }
        let screen = ctx.content_rect();
        let bottom = match minimap {
            Some(minimap) => minimap.top() - CONSOLE_GAP,
            None => screen.bottom() - screen.height() * FALLBACK_BOTTOM_FRACTION,
        };
        let area = Area::new(Id::new("sb_setting_toast"))
            .order(Order::Foreground)
            .interactable(false)
            .anchor(Align2::CENTER_BOTTOM, vec2(0.0, bottom - screen.bottom()));
        let spec = text::body(TEXT_SIZE, BodyWeight::Semibold);
        motion::presence_area(
            ctx,
            Id::new("sb_setting_toast_presence"),
            remaining > 0.0,
            area,
            |ui| {
                // The area keeps the size it last had, so text left to wrap would wrap at the width
                // of whatever shorter notice came before it.
                ui.style_mut().wrap_mode = Some(TextWrapMode::Extend);
                let corner_radius = theme::radius(theme::RADIUS_PANEL);
                let frame = Frame::NONE
                    .fill(FILL)
                    .corner_radius(corner_radius)
                    .inner_margin(MARGIN)
                    .show(ui, |ui| ui.label(spec.job(&self.text)));
                ui.painter().add(Shape::rect_stroke(
                    frame.response.rect,
                    corner_radius,
                    Stroke::new(theme::HAIRLINE, theme::TIER0_STROKE),
                    StrokeKind::Inside,
                ));
            },
        )
        .is_some()
    }
}

/// What the notice says for `change`: the setting and where it now stands, as one phrase.
fn toast_text(change: SettingChange) -> Option<String> {
    Some(match change {
        SettingChange::MusicOn(true) => tr!("settingToast.musicOn", "Music on"),
        SettingChange::MusicOn(false) => tr!("settingToast.musicOff", "Music off"),
        SettingChange::SoundOn(true) => tr!("settingToast.soundOn", "Sound on"),
        SettingChange::SoundOn(false) => tr!("settingToast.soundOff", "Sound off"),
        SettingChange::HdGraphicsOn(true) => tr!("settingToast.hdGraphics", "HD graphics"),
        SettingChange::HdGraphicsOn(false) => tr!("settingToast.sdGraphics", "SD graphics"),
        SettingChange::MinimapTerrain(MinimapTerrain::Shown) => {
            tr!("settingToast.minimapTerrainShown", "Minimap terrain shown")
        }
        SettingChange::MinimapTerrain(MinimapTerrain::Hidden) => {
            tr!(
                "settingToast.minimapTerrainHidden",
                "Minimap terrain hidden"
            )
        }
        SettingChange::MinimapColorMode(MinimapColorMode::Standard) => {
            tr!("settingToast.colorOverridesOff", "Color overrides off")
        }
        SettingChange::MinimapColorMode(MinimapColorMode::PresetOnMinimapOnly) => tr!(
            "settingToast.colorOverridesMinimapOnly",
            "Color overrides on the minimap"
        ),
        SettingChange::MinimapColorMode(MinimapColorMode::Preset) => {
            tr!(
                "settingToast.colorOverridesEverywhere",
                "Color overrides everywhere"
            )
        }
        SettingChange::DisplayMode(DisplayMode::Windowed) => {
            tr!("settingToast.windowed", "Windowed")
        }
        SettingChange::DisplayMode(DisplayMode::WindowedFullscreen) => {
            tr!("settingToast.windowedFullscreen", "Windowed (Fullscreen)")
        }
        SettingChange::DisplayMode(DisplayMode::Fullscreen) => {
            tr!("settingToast.fullscreen", "Fullscreen")
        }
        SettingChange::MouseConfineOn(true) => {
            tr!("settingToast.mouseConfined", "Mouse kept in the window")
        }
        SettingChange::MouseConfineOn(false) => {
            tr!("settingToast.mouseFree", "Mouse free to leave the window")
        }
        SettingChange::ShowFps(true) => tr!("settingToast.fpsShown", "FPS shown"),
        SettingChange::ShowFps(false) => tr!("settingToast.fpsHidden", "FPS hidden"),
        SettingChange::ShowLatency(true) => tr!("settingToast.latencyShown", "Latency shown"),
        SettingChange::ShowLatency(false) => tr!("settingToast.latencyHidden", "Latency hidden"),
        SettingChange::RealTimeLightingOn(true) => {
            tr!("settingToast.realTimeLightingOn", "Real-time lighting on")
        }
        SettingChange::RealTimeLightingOn(false) => {
            tr!("settingToast.realTimeLightingOff", "Real-time lighting off")
        }
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use egui::{Rect, pos2};

    use super::*;

    fn frame_at(ctx: &Context, toast: &mut SettingToast, time: f64) -> bool {
        ctx.begin_pass(egui::RawInput {
            screen_rect: Some(Rect::from_min_size(pos2(0.0, 0.0), vec2(1280.0, 720.0))),
            time: Some(time),
            ..Default::default()
        });
        let shown = toast.draw(ctx, None);
        let mut out = ctx.end_pass();
        let _ = ctx.tessellate(out.shapes, ctx.pixels_per_point());
        out.textures_delta.clear();
        shown
    }

    #[test]
    fn a_notice_holds_then_leaves_on_its_own() {
        let ctx = Context::default();
        crate::install_fonts_and_style(&ctx, &crate::DynamicFonts::default());
        let mut toast = SettingToast::for_change(SettingChange::MusicOn(false)).unwrap();
        assert!(frame_at(&ctx, &mut toast, 0.0));
        assert!(frame_at(&ctx, &mut toast, HOLD_SECS - 0.1));
        // Past the hold it fades, and is gone a moment later.
        assert!(frame_at(&ctx, &mut toast, HOLD_SECS + 0.01));
        assert!(!frame_at(&ctx, &mut toast, HOLD_SECS + 1.0));
    }

    /// A long notice after a short one is as wide as its text, rather than wrapping at the width the
    /// short one left behind.
    #[test]
    fn a_longer_notice_grows_to_fit() {
        let ctx = Context::default();
        crate::install_fonts_and_style(&ctx, &crate::DynamicFonts::default());
        let height = |toast: &mut SettingToast, time| {
            frame_at(&ctx, toast, time);
            ctx.memory(|memory| memory.area_rect(Id::new("sb_setting_toast")))
                .unwrap()
                .height()
        };
        let long = SettingChange::MinimapTerrain(MinimapTerrain::Hidden);
        let one_line = height(&mut SettingToast::for_change(long).unwrap(), 0.0);
        height(
            &mut SettingToast::for_change(SettingChange::MusicOn(false)).unwrap(),
            0.1,
        );
        let after_short = height(&mut SettingToast::for_change(long).unwrap(), 0.2);
        assert_eq!(after_short, one_line);
    }

    #[test]
    fn only_the_games_own_keys_have_notices() {
        assert_eq!(
            toast_text(SettingChange::MinimapColorMode(MinimapColorMode::Standard)).as_deref(),
            Some("Color overrides off")
        );
        assert!(toast_text(SettingChange::MusicVolume(40)).is_none());
    }
}
