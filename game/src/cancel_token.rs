use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{self, Poll};

use futures::prelude::*;
use tokio::sync::oneshot;

/// `CancelToken` is a future resolves to `Err(Canceled)`, if its corresponding `Canceler`
/// is dropped.
///
/// The idea is to bind canceler in some future that receives the result, and send cancel token
/// to the task that calculates it. That task can then do `cancel_token.bind(cancelable_part)`
/// to stop cancelable_part if the receiving future gets dropped.
///
/// Obviously this concept isn't necessary at all if all the work is contained in the result
/// future itself without any inter-task-communication, but that won't really work with state
/// that is shared with tasks. Or, in other words, CancelToken is only used to cancel tasks that
/// are spawned to a executor; if there's no need to spawn anything, canceling will happen
/// automatically.
///
/// Since it's common to use oneshot channels to send results between these kinds of tasks,
/// a `cancelable_channel` function is also provided which cancels the sender's side if
/// receiver is dropped.
pub struct CancelToken(oneshot::Receiver<()>);
pub struct Canceler(oneshot::Sender<()>);

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

pub struct CancelableSender<T> {
    sender: oneshot::Sender<T>,
    token: CancelToken,
}

pub struct CancelableReceiver<T> {
    receiver: oneshot::Receiver<T>,
    #[allow(dead_code)]
    canceler: Canceler,
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
        future::select(
            self.0.then(|_| future::err(())),
            future.map(Ok),
        ).map(|x| x.factor_first().0)
    }
}

impl Canceler {
    pub fn has_ended(&self) -> bool {
        self.0.is_closed()
    }
}

pub fn cancelable_channel<T>() -> (CancelableSender<T>, CancelableReceiver<T>) {
    let (token, canceler) = CancelToken::new();
    let (sender, receiver) = oneshot::channel();
    let sender = CancelableSender { sender, token };
    let receiver = CancelableReceiver { receiver, canceler };
    (sender, receiver)
}

impl<A> CancelableSender<A> {
    /// Creates a future which sends the result of inner future over channel on success,
    /// and cancels immediately on receiver drop.
    pub fn send_result<F>(self, future: F) -> impl Future<Output = ()>
    where
        F: Future<Output = A> + Unpin,
    {
        let sender = self.sender;
        future::select(
            self.token.0,
            future.then(|result| {
                let _ = sender.send(result);
                future::ready(())
            }),
        ).map(|_| ())
    }
}

impl<T> Future for CancelableReceiver<T> {
    type Output = Result<T, ()>;
    fn poll(mut self: Pin<&mut Self>, cx: &mut task::Context) -> Poll<Self::Output> {
        Pin::new(&mut self.receiver).poll(cx).map_err(|_| ())
    }
}
