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
    /// Map pixels of explored fog between the line and currently visible terrain at which the
    /// line starts to show, and at which it shows fully. A line traced right along the edge of
    /// what units see reads as clutter around them. Both 0 always show it.
    pub boundary_clearance_start: f32,
    pub boundary_clearance_full: f32,
}

/// Grain on the game view's unexplored terrain. Grain is what tells unexplored terrain from
/// explored fog on every tileset (a tint gets lost on blue Twilight/Ice terrain). The minimap gets
/// none: at a pixel or two per tile it turns to moire.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GrainStyle {
    /// How strongly grain varies the unexplored darkness, 0 for none.
    pub strength: f32,
    /// Multiplier on the grain's size.
    pub scale: f32,
}

/// BW's tilesets, in the order of their ids.
pub const TILESET_NAMES: [&str; 8] = [
    "Badlands",
    "Space Platform",
    "Installation",
    "Ashworld",
    "Jungle",
    "Desert",
    "Ice",
    "Twilight",
];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FogStyle {
    pub game: ViewFogStyle,
    pub minimap: ViewFogStyle,
    /// Per tileset id: the same grain reads stronger over some terrain than others.
    pub grain: [GrainStyle; 8],
    /// Radius in map pixels of the smoothing the boundary line is traced on, which rounds off
    /// the tile staircase in BW's per-tile mask.
    pub boundary_smoothing: f32,
}

const DEFAULT_GRAIN: GrainStyle = GrainStyle {
    strength: 0.4,
    scale: 0.4,
};

impl FogStyle {
    pub const DEFAULT: FogStyle = FogStyle {
        game: ViewFogStyle {
            unexplored_alpha: 0.88,
            boundary_alpha: 0.04,
            boundary_width: 3.5,
            boundary_brightness: 0.8,
            boundary_clearance_start: 40.0,
            boundary_clearance_full: 120.0,
        },
        minimap: ViewFogStyle {
            unexplored_alpha: 0.84,
            // Faint: a strong outline around the scouted area pulls the eye away from what is
            // currently visible, which matters more on the minimap.
            boundary_alpha: 0.1,
            boundary_width: 2.0,
            boundary_brightness: 0.9,
            boundary_clearance_start: 0.0,
            boundary_clearance_full: 0.0,
        },
        // Indexed by tileset id. Grain reads stronger over Space Platform's, Desert's and Ice's
        // terrain, so they get less of it, in finer cells.
        grain: [
            // Badlands
            DEFAULT_GRAIN,
            // Space Platform
            GrainStyle {
                strength: 0.35,
                scale: 0.3,
            },
            // Installation
            DEFAULT_GRAIN,
            // Ashworld
            DEFAULT_GRAIN,
            // Jungle
            DEFAULT_GRAIN,
            // Desert
            GrainStyle {
                strength: 0.3,
                scale: 0.3,
            },
            // Ice
            GrainStyle {
                strength: 0.25,
                scale: 0.25,
            },
            // Twilight
            DEFAULT_GRAIN,
        ],
        boundary_smoothing: 3.0,
    };

    /// The grain for a tileset id; ids past BW's eight get the first tileset's.
    pub fn grain(&self, tileset: u16) -> &GrainStyle {
        self.grain.get(tileset as usize).unwrap_or(&self.grain[0])
    }

    /// Writes the style for one mask draw (the minimap's or the game view's) on a map of
    /// `tileset` into the mask shader's constants `[8..=16]`, in the order of its cbuffer.
    pub fn write_shader_constants(&self, constants: &mut [f32], is_minimap: bool, tileset: u16) {
        let grain = self.grain(tileset);
        let (view, grain_strength) = if is_minimap {
            (&self.minimap, 0.0)
        } else {
            (&self.game, grain.strength)
        };
        constants[8..17].copy_from_slice(&[
            view.unexplored_alpha,
            grain_strength,
            grain.scale,
            view.boundary_alpha,
            view.boundary_width,
            view.boundary_brightness,
            self.boundary_smoothing,
            view.boundary_clearance_start,
            view.boundary_clearance_full,
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
