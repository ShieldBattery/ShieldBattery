use async_graphql::{Error, ErrorExtensions};
use color_eyre::eyre::eyre;

pub fn graphql_error(code: &'static str, message: &'static str) -> Error {
    eyre!(message).extend_with(|_err, e| {
        e.set("code", code);
        e.set("message", message);
    })
}
