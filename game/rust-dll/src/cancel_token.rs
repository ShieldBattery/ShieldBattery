use tokio::prelude::*;
use tokio::sync::oneshot;

// `CancelToken` is a future resolves to `Err(Canceled)`, if its corresponding `Canceler`
// is dropped.
//
// The idea is to bind canceler in some future that receives the result, and send cancel token
// to the task that calculates it. That task can then do `cancel_token.bind(cancelable_part)`
// to stop cancelable_part if the receiving future gets dropped.
//
// Obviously this concept isn't necessary at all if all the work is contained in the result future
// itself without any inter-task-communication, but that won't really work with state that is
// shared with tasks. Or, in other words, CancelToken is only used to cancel tasks that are
// spawned to a executor; if there's no need to spawn anything, canceling will happen
// automatically.
//
// Since it's common to use oneshot channels to send results between these kinds of tasks,
// a `cancelable_channel` function is also provided which cancels the sender's side if
// receiver is dropped.
pub struct CancelToken(oneshot::Receiver<()>);
pub struct Canceler(oneshot::Sender<()>);

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

    pub fn bind<F, I>(self, future: F) -> impl Future<Item = I, Error = ()>
    where F: Future<Item = I, Error = ()>
    {
        self.0.then(|_| Err(())).select(future)
            .map(|x| x.0)
            .map_err(|_| ())
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
    let sender = CancelableSender {
        sender,
        token,
    };
    let receiver = CancelableReceiver {
        receiver,
        canceler,
    };
    (sender, receiver)
}

impl<A, B> CancelableSender<Result<A, B>> {
    /// Creates a future which sends the result of inner future over channel on success,
    /// and cancels immediately on receiver drop.
    pub fn send_result<F>(self, future: F) -> impl Future<Item = (), Error = ()>
    where F: Future<Item = A, Error = B>,
    {
        let sender = self.sender;
        self.token.0.map_err(|_| ()).select(
            future.then(|result| {
                let _ = sender.send(result);
                Ok(())
            })
        ).map(|_| ()).map_err(|_| ())
    }
}

impl<T> Future for CancelableReceiver<T> {
    type Item = T;
    type Error = ();
    fn poll(&mut self) -> Poll<Self::Item, Self::Error> {
        self.receiver.poll().map_err(|_| ())
    }
}
