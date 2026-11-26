//! The series' logo, loaded for the observer panels from the URL the game's setup names.
//!
//! egui's image loaders fetch and decode it on threads of their own, and a frame only asks them
//! how it is going, so nothing waits on the network. Once decoded it is scaled to the size the
//! panels draw it at, on a thread of its own too: the renderer samples a texture with no mipmaps,
//! and an upload drawn at a quarter of its size that way loses its detail to aliasing. A screen of
//! another density gets it scaled again.
//!
//! A logo that cannot be loaded is left off for the rest of the game, with one line in the log
//! saying why, and so is one the loaders are still waiting on after [`FETCH_TIMEOUT`]: a request
//! that never answers otherwise stays pending for the whole game, the loaders putting no limit on
//! how long a server takes to start answering.

use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, TryRecvError};
use std::time::{Duration, Instant};

use egui::load::{ImagePoll, SizeHint};
use egui::{ColorImage, Context, TextureHandle, TextureOptions};
use image::RgbaImage;
use image::imageops::FilterType;
use overlay_ui::observer::{SeriesLogo, series_logo_size};

/// How long the loaders are given to fetch and decode the logo before it is left off.
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);

/// The most of a load error's text the log is given: an error page's body follows its status.
const MAX_ERROR_CHARS: usize = 300;

/// The series' logo for one game, from asking for it to drawing it.
pub(super) struct SeriesLogoLoader {
    url: String,
    stage: Stage,
}

enum Stage {
    /// Not asked of the loaders yet.
    Unrequested,
    /// Asked of the loaders at the given time, which are fetching and decoding it.
    Fetching(Instant),
    /// Decoded, and drawn from `texture` once it is scaled for the screen.
    Loaded {
        image: Arc<ColorImage>,
        /// The texture the panels draw, and the density it was scaled for.
        texture: Option<(f32, TextureHandle)>,
        /// A scaling under way, and the density it is for.
        scaling: Option<(f32, Receiver<ColorImage>)>,
    },
    /// Left off for the rest of the game.
    Failed,
}

impl SeriesLogoLoader {
    pub(super) fn new(url: String) -> SeriesLogoLoader {
        SeriesLogoLoader {
            url,
            stage: Stage::Unrequested,
        }
    }

    /// The logo as the panels draw it this frame, asking the loaders for it on the first frame it is
    /// wanted on. Nothing until it has loaded and been scaled, and nothing once it has failed.
    pub(super) fn poll(&mut self, ctx: &Context) -> Option<SeriesLogo> {
        if let Stage::Unrequested | Stage::Fetching(_) = self.stage {
            let asked = match self.stage {
                Stage::Fetching(asked) => asked,
                _ => Instant::now(),
            };
            match ctx.try_load_image(&self.url, SizeHint::default()) {
                Ok(ImagePoll::Ready { image }) if image.width() > 0 && image.height() > 0 => {
                    // The decoded image is kept here, so the loaders' copies of it and of its bytes
                    // are let go.
                    ctx.forget_image(&self.url);
                    debug!(
                        "Loaded the series logo from {} ({}x{})",
                        self.url,
                        image.width(),
                        image.height()
                    );
                    self.stage = Stage::Loaded {
                        image,
                        texture: None,
                        scaling: None,
                    };
                }
                Ok(ImagePoll::Ready { .. }) => self.fail("the image is empty"),
                Ok(ImagePoll::Pending { .. }) if asked.elapsed() >= FETCH_TIMEOUT => {
                    // Forgotten, so a response that does come is dropped rather than kept.
                    ctx.forget_image(&self.url);
                    self.fail(&format!(
                        "still loading after {} seconds",
                        FETCH_TIMEOUT.as_secs()
                    ));
                }
                Ok(ImagePoll::Pending { .. }) => self.stage = Stage::Fetching(asked),
                Err(error) => {
                    ctx.forget_image(&self.url);
                    self.fail(&error.to_string());
                }
            }
        }
        let pixels_per_point = ctx.pixels_per_point();
        let Stage::Loaded {
            image,
            texture,
            scaling,
        } = &mut self.stage
        else {
            return None;
        };
        if let Some((density, done)) = scaling {
            match done.try_recv() {
                Ok(scaled) => {
                    let handle = ctx.load_texture("sb_series_logo", scaled, TextureOptions::LINEAR);
                    *texture = Some((*density, handle));
                    *scaling = None;
                }
                Err(TryRecvError::Empty) => {}
                Err(TryRecvError::Disconnected) => {
                    self.fail("scaling it stopped without a result");
                    return None;
                }
            }
        }
        let stale = texture
            .as_ref()
            .is_none_or(|(density, _)| *density != pixels_per_point);
        if stale && scaling.is_none() {
            let target = drawn_pixels(image, pixels_per_point);
            if target == [image.width(), image.height()] || !fits_within(image, target) {
                // Already no larger than it is drawn: uploaded as it is, never enlarged.
                let handle = ctx.load_texture(
                    "sb_series_logo",
                    ColorImage::clone(image),
                    TextureOptions::LINEAR,
                );
                *texture = Some((pixels_per_point, handle));
            } else {
                let (send, receive) = mpsc::channel();
                let source = image.clone();
                let spawned = std::thread::Builder::new()
                    .name("sb_series_logo".into())
                    .spawn(move || {
                        let _ = send.send(scaled(&source, target));
                    });
                match spawned {
                    Ok(_) => *scaling = Some((pixels_per_point, receive)),
                    Err(error) => {
                        self.fail(&format!("couldn't start scaling it: {error}"));
                        return None;
                    }
                }
            }
        }
        texture.as_ref().map(|(_, handle)| {
            let [width, height] = handle.size();
            SeriesLogo {
                texture: handle.id(),
                size: [width as u32, height as u32],
            }
        })
    }

    /// Leaves the logo off for the rest of the game, saying why once.
    fn fail(&mut self, why: &str) {
        let why: String = why.chars().take(MAX_ERROR_CHARS).collect();
        warn!("Not showing the series logo from {}: {why}", self.url);
        self.stage = Stage::Failed;
    }
}

/// The size in pixels `image` is drawn at on a screen of `pixels_per_point`, at its largest.
fn drawn_pixels(image: &ColorImage, pixels_per_point: f32) -> [usize; 2] {
    let size = series_logo_size([image.width() as u32, image.height() as u32]) * pixels_per_point;
    [
        (size.x.ceil() as usize).max(1),
        (size.y.ceil() as usize).max(1),
    ]
}

/// Whether `target` is no larger than `image` either way, which is what scaling it down needs.
fn fits_within(image: &ColorImage, [width, height]: [usize; 2]) -> bool {
    width <= image.width() && height <= image.height()
}

/// `image` scaled down to `target` pixels. Scaled as the premultiplied colors it holds, so a clear
/// edge's color never bleeds into what is beside it.
fn scaled(image: &ColorImage, [width, height]: [usize; 2]) -> ColorImage {
    let bytes: &[u8] = bytemuck::cast_slice(&image.pixels);
    let Some(source) =
        RgbaImage::from_raw(image.width() as u32, image.height() as u32, bytes.to_vec())
    else {
        return image.clone();
    };
    let mut resized =
        image::imageops::resize(&source, width as u32, height as u32, FilterType::Lanczos3);
    // Lanczos rings past the coverage it was given; a premultiplied color is never more than its
    // alpha.
    for pixel in resized.pixels_mut() {
        let alpha = pixel.0[3];
        for channel in &mut pixel.0[..3] {
            *channel = (*channel).min(alpha);
        }
    }
    ColorImage::from_rgba_premultiplied([width, height], resized.as_raw())
}

#[cfg(test)]
mod tests {
    use egui::Color32;

    use super::*;

    fn wordmark() -> ColorImage {
        ColorImage::new(
            [576, 144],
            (0..576 * 144)
                .map(|index| match index % 7 {
                    0 => Color32::TRANSPARENT,
                    _ => Color32::from_rgba_premultiplied(120, 60, 30, 200),
                })
                .collect(),
        )
    }

    #[test]
    fn a_logo_is_scaled_to_the_pixels_it_is_drawn_at() {
        let image = wordmark();
        assert_eq!(drawn_pixels(&image, 1.0), [144, 36]);
        assert_eq!(drawn_pixels(&image, 4.0 / 3.0), [192, 48]);
        assert_eq!(drawn_pixels(&image, 2.0), [288, 72]);
        let small = scaled(&image, [144, 36]);
        assert_eq!(small.size, [144, 36]);
        for pixel in &small.pixels {
            let [r, g, b, a] = pixel.to_array();
            assert!(r <= a && g <= a && b <= a);
        }
    }

    #[test]
    fn a_logo_drawn_larger_than_it_is_is_never_enlarged() {
        let image = ColorImage::new([20, 20], vec![Color32::WHITE; 400]);
        let target = drawn_pixels(&image, 1.0);
        assert_eq!(target, [36, 36]);
        assert!(!fits_within(&image, target));
    }
}
