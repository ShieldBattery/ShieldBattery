//! How the transparent starting fog draws never-explored terrain. The style is written into the
//! mask shader's constants (`shaders/mask.hlsl`) every frame; debug builds can adjust it live from
//! the overlay's Debug window.

use parking_lot::Mutex;

/// The parts of the style the game view and the minimap set separately.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ViewFogStyle {
    /// Darkening of unexplored terrain (explored fog is 170/255).
    pub unexplored_alpha: f32,
    /// Line along the explored/unexplored boundary, 0 to hide it.
    pub boundary_alpha: f32,
    /// In screen pixels.
    pub boundary_width: f32,
    /// 0 draws the line black, 1 in its light color.
    pub boundary_brightness: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FogStyle {
    pub game: ViewFogStyle,
    pub minimap: ViewFogStyle,
    /// How strongly grain varies the game view's unexplored darkness, 0 for none. Grain is what
    /// tells unexplored terrain from explored fog on every tileset (a tint gets lost on blue
    /// Twilight/Ice terrain). The minimap gets none: at a pixel or two per tile it turns to
    /// moire.
    pub grain_strength: f32,
    /// Multiplier on the grain's size.
    pub grain_scale: f32,
    /// Radius in map pixels of the smoothing the boundary line is traced on, which rounds off
    /// the tile staircase in BW's per-tile mask.
    pub boundary_smoothing: f32,
}

impl FogStyle {
    pub const DEFAULT: FogStyle = FogStyle {
        game: ViewFogStyle {
            unexplored_alpha: 0.88,
            boundary_alpha: 0.05,
            boundary_width: 3.5,
            boundary_brightness: 1.0,
        },
        minimap: ViewFogStyle {
            unexplored_alpha: 0.84,
            // Faint: a strong outline around the scouted area pulls the eye away from what is
            // currently visible, which matters more on the minimap.
            boundary_alpha: 0.1,
            boundary_width: 2.0,
            boundary_brightness: 0.9,
        },
        grain_strength: 0.4,
        grain_scale: 0.4,
        boundary_smoothing: 3.0,
    };

    /// Writes the style for one mask draw (the minimap's or the game view's) into the mask
    /// shader's constants `[8..=14]`, in the order of its cbuffer.
    pub fn write_shader_constants(&self, constants: &mut [f32], is_minimap: bool) {
        let (view, grain_strength) = if is_minimap {
            (&self.minimap, 0.0)
        } else {
            (&self.game, self.grain_strength)
        };
        constants[8..15].copy_from_slice(&[
            view.unexplored_alpha,
            grain_strength,
            self.grain_scale,
            view.boundary_alpha,
            view.boundary_width,
            view.boundary_brightness,
            self.boundary_smoothing,
        ]);
    }
}

static FOG_STYLE: Mutex<FogStyle> = Mutex::new(FogStyle::DEFAULT);

pub fn fog_style() -> FogStyle {
    *FOG_STYLE.lock()
}

pub fn set_fog_style(style: FogStyle) {
    *FOG_STYLE.lock() = style;
}
