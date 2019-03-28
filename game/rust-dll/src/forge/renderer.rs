use winapi::shared::windef::{HWND};

pub struct Renderer {
}

impl Renderer {
    pub fn new_directx() -> Renderer {
        Renderer {
        }
    }

    pub fn uses_swap_buffers(&self) -> bool {
        // TODO change if opengl support
        false
    }

    pub fn render(&mut self) {
        error!("Rendering unimplemented");
    }

    pub fn initialize(&mut self, window: HWND, width: u32, height: u32) {
        error!("Rendering unimplemented");
    }
}
