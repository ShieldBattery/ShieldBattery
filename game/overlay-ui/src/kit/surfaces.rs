//! Placement transforms shared by the observer's independently movable surfaces.
use egui::{Context, Id, LayerId, Rect, Vec2, emath::TSTransform, pos2};

#[derive(Clone)]
pub(crate) struct Config {
    pub id: Id,
    pub position: Option<[i32; 2]>,
    pub blocked: bool,
}

#[derive(Clone, Copy)]
pub(crate) struct Surface {
    pub layer: LayerId,
    pub source: Rect,
    pub rect: Rect,
    pub layout_rect: Rect,
    pub transform: TSTransform,
    pub shown: bool,
}

#[derive(Clone, Default)]
struct Session {
    configs: Vec<Config>,
    surfaces: Vec<Surface>,
}

fn key() -> Id {
    Id::new("observer_surface_layout")
}

pub(crate) fn begin(ctx: &Context, configs: Vec<Config>) {
    ctx.data_mut(|data| {
        data.insert_temp(
            key(),
            Session {
                configs,
                surfaces: Vec::new(),
            },
        )
    });
}

pub(crate) fn config(ctx: &Context, id: Id) -> Option<Config> {
    ctx.data_mut(|data| {
        data.get_temp_mut_or_default::<Session>(key())
            .configs
            .iter()
            .find(|config| config.id == id)
            .cloned()
    })
}

pub(crate) fn finish(ctx: &Context) -> Vec<Surface> {
    ctx.data_mut(|data| data.remove_temp::<Session>(key()))
        .unwrap_or_default()
        .surfaces
}

pub(crate) fn transform(ctx: &Context, layer: LayerId, source: Rect, slide: Vec2, shown: bool) {
    let Some(config) = config(ctx, layer.id) else {
        ctx.set_transform_layer(layer, TSTransform::from_translation(slide));
        return;
    };
    let min = config
        .position
        .map_or(source.min, |[x, y]| pos2(x as f32, y as f32));
    let rect = Rect::from_min_size(min, source.size());
    let rect = crate::observer::manipulation::snap_rect(rect, &[], ctx.viewport_rect(), 0.0);
    let transform = TSTransform::from_translation(rect.min - source.min);
    let transform = transform * TSTransform::from_translation(slide);
    ctx.set_transform_layer(layer, transform);
    ctx.data_mut(|data| {
        data.get_temp_mut_or_default::<Session>(key())
            .surfaces
            .push(Surface {
                layer,
                source,
                rect: transform * source,
                layout_rect: rect,
                transform,
                shown,
            })
    });
}

/// Converts a point measured inside a surface into screen coordinates for a separate popover.
pub(crate) fn global(ctx: &Context, layer: LayerId, point: egui::Pos2) -> egui::Pos2 {
    ctx.layer_transform_to_global(layer).unwrap_or_default() * point
}
