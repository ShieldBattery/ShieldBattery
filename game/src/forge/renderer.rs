use std::mem;
use std::time::{Duration, Instant};
use std::ptr::null_mut;

use winapi::shared::windef::{HWND};
use winapi::um::wingdi::PALETTEENTRY;

use super::direct_x;
use super::indirect_draw::IndirectDraw;
use super::Settings;

pub struct Renderer {
    renderer: Option<Box<dyn RenderApi>>,
    indirect_draw: Option<*mut IndirectDraw>,
    last_render: Instant,
    min_frame_delay: Duration,
}

pub trait RenderApi {
    fn update_palette(&mut self, palettes: &[PALETTEENTRY]);
    fn render(&mut self, pixels: &[u8]);
}

fn device_display_frequency() -> Option<u32> {
    use winapi::um::wingdi::DEVMODEW;
    use winapi::um::winuser::{ENUM_CURRENT_SETTINGS, EnumDisplaySettingsW};
    unsafe {
        let mut devmode = DEVMODEW {
            dmSize: mem::size_of::<DEVMODEW>() as u16,
            ..mem::zeroed()
        };
        let success = EnumDisplaySettingsW(null_mut(), ENUM_CURRENT_SETTINGS, &mut devmode);
        if success != 0 {
            Some(devmode.dmDisplayFrequency).filter(|&x| x > 1)
        } else {
            warn!("Couldn't get display settings: {}", std::io::Error::last_os_error());
            None
        }
    }
}

impl Renderer {
    pub fn new() -> Renderer {
        // If we can't get display frequency, or it is below 60hz for some reason,
        // still assume 60hz.
        let display_frequency = device_display_frequency()
            .unwrap_or(60)
            .max(60);
        Renderer {
            renderer: None,
            indirect_draw: None,
            last_render: Instant::now(),
            // We allow updates 4x as fast, as BW makes no attempt to sync to vblank.
            // This means that if we hit a two or more frames in the same vblank range,
            // one at the beginning and one at the end, we would skip the second one and
            // be stuck waiting until BW comes back around and calls us
            // (which might be longer than the *next* vblank window, thus skipping a frame).
            min_frame_delay: Duration::from_secs(1) / display_frequency / 4,
        }
    }

    pub fn render(&mut self) {
        let now = Instant::now();
        if now.duration_since(self.last_render) < self.min_frame_delay {
            return;
        }
        self.last_render = now;

        let renderer = match self.renderer {
            Some(ref mut s) => s,
            None => return,
        };
        let indirect_draw = match self.indirect_draw {
            Some(s) => s,
            None => return,
        };
        if let Some(palette) = unsafe { (*indirect_draw).new_palette() } {
            renderer.update_palette(&palette);
        }
        if let Some(frame) = unsafe { (*indirect_draw).new_frame() } {
            renderer.render(&frame);
        }
    }

    pub fn initialize(
        &mut self,
        indirect_draw: *mut IndirectDraw,
        window: HWND,
        settings: &Settings,
        width: u32,
        height: u32,
    ) {
        let renderer = match direct_x::Renderer::new(window, settings, width, height) {
            Ok(o) => o,
            Err(e) => {
                panic!("Couldn't initialize Direct3D renderer: {}", e);
            }
        };
        self.indirect_draw = Some(indirect_draw);
        self.renderer = Some(Box::new(renderer));
    }
}
