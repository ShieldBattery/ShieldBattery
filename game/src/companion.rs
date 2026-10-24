pub struct Response {
    pub key_id: u32,
    pub body: Vec<u8>,
    pub signature: [u8; 64],
}

#[cfg(sb_companion)]
mod implementation {
    include!(env!("SB_GAME_COMPANION_ENTRY"));
}

#[cfg(not(sb_companion))]
mod implementation {
    pub fn initialize(_server_port: u16) {
        // TODO(tec27): implement
    }

    pub fn collect(_message: &dyn Fn(u32, &[u8]) -> Vec<u8>) -> Option<super::Response> {
        // TODO(tec27): implement
        None
    }
}

/// Called on the main thread during injection, before game hooks or async tasks start.
pub fn initialize(server_port: u16) {
    implementation::initialize(server_port)
}

#[inline(always)]
pub fn collect(message: impl Fn(u32, &[u8]) -> Vec<u8>) -> Option<Response> {
    implementation::collect(&message)
}
