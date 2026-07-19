use std::sync::{Arc, Mutex};

use futures::prelude::*;
use tokio::sync::oneshot;

/// `CancelToken` is a future that resolves to `Err(())` if its corresponding `Canceler` is dropped.
///
/// The idea is to bind the canceler in some future that receives the result, and send the cancel
/// token to the task that calculates it. That task can then do `cancel_token.bind(cancelable_part)`
/// to stop `cancelable_part` if the receiving future gets dropped.
///
/// Obviously this concept isn't necessary at all if all the work is contained in the result future
/// itself without any inter-task communication, but that won't really work with state that is
/// shared with tasks. In other words, `CancelToken` is only used to cancel tasks that are spawned
/// to an executor; if there's no need to spawn anything, canceling will happen automatically.
pub struct CancelToken(oneshot::Receiver<()>);
/// Dropping this (or all `SharedCanceler` owners holding it) resolves the paired `CancelToken`. The
/// wrapped sender is never read directly — its drop is the cancel signal.
pub struct Canceler(#[allow(dead_code)] oneshot::Sender<()>);

/// Allows sharing the canceler - any of the owners can cancel immediately,
/// and of course dropping all owners also causes a cancelation.
#[derive(Clone)]
pub struct SharedCanceler(Arc<Mutex<Option<Canceler>>>);

impl SharedCanceler {
    pub fn new(canceler: Canceler) -> SharedCanceler {
        SharedCanceler(Arc::new(Mutex::new(Some(canceler))))
    }

    pub fn cancel(&self) {
        *self.0.lock().unwrap() = None;
    }
}

impl CancelToken {
    pub fn new() -> (CancelToken, Canceler) {
        let (send, recv) = oneshot::channel();
        (CancelToken(recv), Canceler(send))
    }

    pub fn bind<F, I>(self, future: F) -> impl Future<Output = Result<I, ()>>
    where
        F: Future<Output = I> + Unpin,
    {
        future::select(self.0.then(|_| future::err(())), future.map(Ok)).map(|x| x.factor_first().0)
    }
}
