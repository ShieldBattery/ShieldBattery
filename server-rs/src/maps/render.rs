//! Renders map preview images from StarCraft: Remastered's SD assets.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use broodmap::Chk;
use broodmap_render::{
    AssetRequest, DirSource, RenderOptions, SourceError, TilesetDataSource, render_chk_preview,
};
use color_eyre::eyre::{self, eyre};
use jpeg_encoder::{ColorType, Encoder};

/// The image sizes rendered for every map, as the longest side in pixels. Maps render at a whole
/// number of pixels per tile, so an image can come out somewhat smaller.
pub const MAP_IMAGE_SIZES: [u32; 4] = [256, 512, 1024, 2048];

const JPEG_QUALITY: u8 = 90;

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

/// A rendered JPEG image for one of [`MAP_IMAGE_SIZES`].
pub struct MapImage {
    pub size: u32,
    pub jpeg: Vec<u8>,
}

/// Renders the map at every size in [`MAP_IMAGE_SIZES`], with start locations shown and units
/// filtered as the game does for melee games.
pub fn render_map_images(chk: &Chk, assets: &MapRenderAssets) -> eyre::Result<Vec<MapImage>> {
    MAP_IMAGE_SIZES
        .iter()
        .map(|&size| {
            let options = RenderOptions {
                max_dimension: Some(size),
                ..RenderOptions::default()
            };
            let preview = render_chk_preview(chk, assets, &options)?;
            let image = preview.image;
            let (Ok(width), Ok(height)) = (u16::try_from(image.width), u16::try_from(image.height))
            else {
                return Err(eyre!("rendered image is too large to encode"));
            };
            if width == 0 || height == 0 {
                return Err(eyre!("map has no terrain to render"));
            }
            let mut jpeg = Vec::new();
            Encoder::new(&mut jpeg, JPEG_QUALITY).encode(
                &image.data,
                width,
                height,
                ColorType::Rgba,
            )?;
            Ok(MapImage { size, jpeg })
        })
        .collect()
}
