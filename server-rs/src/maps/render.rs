//! Renders map preview images from StarCraft: Remastered's SD assets.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use broodmap::Chk;
use broodmap_render::{
    AssetRequest, DirSource, MinimapOptions, RenderOptions, RgbaImage, SourceError, StartLocations,
    TilesetDataSource, UnitFilter, render_chk_minimap, render_chk_preview,
};
use color_eyre::eyre::{self, eyre};
use jpeg_encoder::{ColorType, Encoder};
use rgb::FromSlice;

/// The version of the image rendering. Bump it when a change (to the render options, sizes,
/// formats, the broodmap revision or the asset set) changes what the rendered images look like;
/// every map is then rendered again.
pub const MAP_RENDER_VERSION: i32 = 1;

/// The image sizes rendered as AVIF for every map, as the longest side in pixels. Maps render at
/// a whole number of pixels per tile, so an image can come out somewhat smaller.
pub const MAP_IMAGE_SIZES: [u32; 4] = [256, 512, 1024, 2048];
/// The size also rendered as a JPEG, for consumers that can't decode AVIF (link previews and the
/// game's loading screen).
pub const MAP_JPEG_SIZE: u32 = 1024;

/// Keeps terrain detail close to JPEG at quality 90 in about half the bytes. Lower qualities smooth
/// away the terrain's grain, and slower speeds take about 3x longer for files only ~10% smaller.
const AVIF_QUALITY: f32 = 80.0;
const AVIF_SPEED: u8 = 10;
const JPEG_QUALITY: u8 = 90;
/// The largest magnification of a zero-asset minimap, which is at most 128 px per side.
const MAX_MINIMAP_SCALE: u32 = 16;

/// The render assets, read from disk on first use and then kept in memory. A render touches
/// about 46 MB of assets, and the whole set is about 100 MB.
pub struct MapRenderAssets {
    dir: DirSource,
    cache: Mutex<HashMap<AssetRequest, Arc<[u8]>>>,
}

impl MapRenderAssets {
    pub fn new(dir: &Path) -> eyre::Result<Self> {
        if !dir.join("SD").join("mainSD.anim").is_file() {
            return Err(eyre!(
                "{} doesn't contain StarCraft: Remastered SD assets (SD/mainSD.anim is missing)",
                dir.display()
            ));
        }
        Ok(Self {
            dir: DirSource::new(dir),
            cache: Mutex::new(HashMap::new()),
        })
    }
}

impl TilesetDataSource for MapRenderAssets {
    fn read(&self, req: &AssetRequest) -> Result<Arc<[u8]>, SourceError> {
        if let Some(data) = self.cache.lock().expect("asset cache lock").get(req) {
            return Ok(data.clone());
        }
        let data = self.dir.read(req)?;
        self.cache
            .lock()
            .expect("asset cache lock")
            .insert(req.clone(), data.clone());
        Ok(data)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MapImageFormat {
    Avif,
    Jpeg,
}

impl MapImageFormat {
    pub fn extension(self) -> &'static str {
        match self {
            MapImageFormat::Avif => "avif",
            MapImageFormat::Jpeg => "jpg",
        }
    }

    pub fn content_type(self) -> &'static str {
        match self {
            MapImageFormat::Avif => "image/avif",
            MapImageFormat::Jpeg => "image/jpeg",
        }
    }
}

/// One encoded image of a map.
pub struct MapImage {
    pub size: u32,
    pub format: MapImageFormat,
    pub data: Vec<u8>,
}

/// Every image of a map: each of [`MAP_IMAGE_SIZES`] as AVIF, plus [`MAP_JPEG_SIZE`] as JPEG.
pub struct MapImages {
    pub images: Vec<MapImage>,
    /// Whether these are zero-asset minimaps, rendered because no assets were available. They're
    /// replaced by real renders once assets are.
    pub fallback: bool,
}

/// Renders a map's images without start locations, which clients draw on top themselves. Maps
/// with UMS content show their units as placed; other maps filter units as melee games do.
/// Without `assets`, renders zero-asset minimaps instead.
pub fn render_map_images(
    chk: &Chk,
    ums_content: bool,
    assets: Option<&MapRenderAssets>,
) -> eyre::Result<MapImages> {
    let unit_filter = if ums_content {
        UnitFilter::AsPlaced
    } else {
        UnitFilter::Melee
    };
    let mut images = Vec::with_capacity(MAP_IMAGE_SIZES.len() + 1);
    for size in MAP_IMAGE_SIZES {
        let image = match assets {
            Some(assets) => {
                let options = RenderOptions {
                    max_dimension: Some(size),
                    start_locations: StartLocations::Hidden,
                    unit_filter,
                    ..RenderOptions::default()
                };
                render_chk_preview(chk, assets, &options)?.image
            }
            None => render_minimap(chk, size, unit_filter),
        };
        if image.width == 0 || image.height == 0 {
            return Err(eyre!("map has no terrain to render"));
        }
        images.push(MapImage {
            size,
            format: MapImageFormat::Avif,
            data: encode_avif(&image)?,
        });
        if size == MAP_JPEG_SIZE {
            images.push(MapImage {
                size,
                format: MapImageFormat::Jpeg,
                data: encode_jpeg(&image)?,
            });
        }
    }
    Ok(MapImages {
        images,
        fallback: assets.is_none(),
    })
}

fn render_minimap(chk: &Chk, size: u32, unit_filter: UnitFilter) -> RgbaImage {
    let native = render_chk_minimap(
        chk,
        None,
        &MinimapOptions {
            highlight_resources: false,
            start_locations: StartLocations::Hidden,
            unit_filter,
            ..MinimapOptions::default()
        },
    )
    .image;
    let longest_side = native.width.max(native.height).max(1);
    let scale = (size / longest_side).clamp(1, MAX_MINIMAP_SCALE);
    if scale == 1 {
        return native;
    }
    let width = native.width * scale;
    let height = native.height * scale;
    let mut data = Vec::with_capacity(width as usize * height as usize * 4);
    for y in 0..height {
        let row_start = (y / scale) as usize * native.width as usize * 4;
        for x in 0..native.width as usize {
            let pixel = &native.data[row_start + x * 4..row_start + x * 4 + 4];
            for _ in 0..scale {
                data.extend_from_slice(pixel);
            }
        }
    }
    RgbaImage {
        width,
        height,
        data,
    }
}

fn encode_avif(image: &RgbaImage) -> eyre::Result<Vec<u8>> {
    let pixels = image.data.as_rgba();
    let img = ravif::Img::new(pixels, image.width as usize, image.height as usize);
    let encoded = ravif::Encoder::new()
        .with_quality(AVIF_QUALITY)
        .with_speed(AVIF_SPEED)
        .with_alpha_quality(AVIF_QUALITY)
        .encode_rgba(img)?;
    Ok(encoded.avif_file)
}

fn encode_jpeg(image: &RgbaImage) -> eyre::Result<Vec<u8>> {
    let (Ok(width), Ok(height)) = (u16::try_from(image.width), u16::try_from(image.height)) else {
        return Err(eyre!("rendered image is too large to encode"));
    };
    let mut jpeg = Vec::new();
    Encoder::new(&mut jpeg, JPEG_QUALITY).encode(&image.data, width, height, ColorType::Rgba)?;
    Ok(jpeg)
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use super::*;

    /// Renders every map file in `SB_MAP_RENDER_CORPUS` and prints render/encode times and image
    /// sizes, for tuning the encoders. Uses the assets in `SB_MAP_ASSETS` if set.
    #[test]
    #[ignore]
    fn render_corpus() {
        let dir = std::env::var("SB_MAP_RENDER_CORPUS").expect("SB_MAP_RENDER_CORPUS is set");
        let assets = std::env::var("SB_MAP_ASSETS")
            .ok()
            .map(|dir| MapRenderAssets::new(Path::new(&dir)).expect("assets load"));
        let limit = std::env::var("SB_MAP_RENDER_LIMIT")
            .ok()
            .and_then(|l| l.parse().ok())
            .unwrap_or(usize::MAX);
        let mut paths: Vec<_> = std::fs::read_dir(dir)
            .expect("corpus dir is readable")
            .map(|e| e.expect("dir entry").path())
            .collect();
        paths.sort();
        let mut totals: HashMap<(u32, &str), usize> = HashMap::new();
        let mut total_time = 0.0;
        let mut count = 0;
        for path in paths.into_iter().take(limit) {
            let bytes = std::fs::read(&path).expect("map file is readable");
            let Ok(parsed) = crate::maps::parse::parse_map(&bytes, None) else {
                continue;
            };
            let start = Instant::now();
            let images = render_map_images(&parsed.chk, parsed.parsed.ums_content, assets.as_ref())
                .expect("map renders");
            let elapsed = start.elapsed().as_secs_f64();
            total_time += elapsed;
            count += 1;
            println!(
                "{} {}x{} {elapsed:.2}s",
                path.file_name().unwrap().to_string_lossy(),
                parsed.parsed.width,
                parsed.parsed.height
            );
            for image in images.images {
                *totals
                    .entry((image.size, image.format.extension()))
                    .or_default() += image.data.len();
            }
        }
        println!("{count} maps, {total_time:.1}s total");
        let mut totals: Vec<_> = totals.into_iter().collect();
        totals.sort();
        for ((size, ext), bytes) in totals {
            println!("{size} {ext}: mean {} KiB", bytes / count.max(1) / 1024);
        }
    }
}
