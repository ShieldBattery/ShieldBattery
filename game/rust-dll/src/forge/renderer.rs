
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
}
