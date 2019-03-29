use winapi::shared::windef::{HWND};
use winapi::um::wingdi::PALETTEENTRY;

use super::direct_x;
use super::indirect_draw::IndirectDraw;
use super::Settings;

pub struct Renderer {
    renderer: Option<Box<dyn RenderApi>>,
    indirect_draw: Option<*mut IndirectDraw>,
}

pub trait RenderApi {
    fn update_palette(&mut self, palettes: &[PALETTEENTRY]);
    fn render(&mut self, pixels: &[u8]);
}

impl Renderer {
    pub fn new() -> Renderer {
        Renderer {
            renderer: None,
            indirect_draw: None,
        }
    }

    pub fn uses_swap_buffers(&self) -> bool {
        // TODO change if opengl support
        false
    }

    pub fn render(&mut self) {
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
