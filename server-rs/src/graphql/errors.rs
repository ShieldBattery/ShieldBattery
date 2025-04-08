use async_graphql::{Error, ErrorExtensions};
use color_eyre::eyre::eyre;

// TODO(tec27): We need some better way of documenting/restricting codes here, and it would probably
// make sense to do that via an Error type that can be converted into a graphql Error automatically
// + assigns these extension values during that
pub fn graphql_error(code: &'static str, message: impl Into<String>) -> Error {
    let message = message.into();
    eyre!(message.clone()).extend_with(|_err, e| {
        e.set("code", code);
        e.set("message", message);
    })
}
