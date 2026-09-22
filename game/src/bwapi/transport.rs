//! Nonblocking Windows transport for BWAPI 4.4 external clients.
//!
//! Native clients send a four-byte little-endian code over the message-mode named pipe. The
//! JBWAPI Java clients send their `1` request as one byte; the server accepts both request
//! widths and always publishes its four-byte little-endian `2` snapshot code. The large state
//! itself lives in a named file mapping. This module never waits for either side, because it is
//! called from the game thread.

use std::{
    ffi::CString,
    io,
    mem::size_of,
    ptr::{self, NonNull},
    sync::atomic::{AtomicU32, Ordering},
};

use winapi::{
    shared::{
        minwindef::{DWORD, FALSE},
        winerror::{
            ERROR_BROKEN_PIPE, ERROR_MORE_DATA, ERROR_NO_DATA, ERROR_PIPE_CONNECTED,
            ERROR_PIPE_LISTENING,
        },
    },
    um::{
        errhandlingapi::GetLastError,
        fileapi::{ReadFile, WriteFile},
        handleapi::{CloseHandle, INVALID_HANDLE_VALUE},
        memoryapi::{FILE_MAP_READ, FILE_MAP_WRITE, MapViewOfFile, UnmapViewOfFile},
        minwinbase::STILL_ACTIVE,
        namedpipeapi::{ConnectNamedPipe, DisconnectNamedPipe},
        processthreadsapi::{GetCurrentProcessId, GetExitCodeProcess, OpenProcess},
        sysinfoapi::GetTickCount,
        winbase::{
            CreateFileMappingA, CreateNamedPipeA, PIPE_ACCESS_DUPLEX, PIPE_NOWAIT,
            PIPE_READMODE_MESSAGE, PIPE_TYPE_MESSAGE,
        },
        winnt::{HANDLE, PAGE_READWRITE, PROCESS_QUERY_LIMITED_INFORMATION},
    },
};

use super::wire::{CLIENT_VERSION, GameData, GameInstance, GameTable, MAX_GAME_INSTANCES};

const PIPE_BUFFER_SIZE: DWORD = 4_096;
const PIPE_DEFAULT_TIMEOUT_MS: DWORD = 3_000;
const CLIENT_REQUEST: i32 = 1;
const SERVER_SNAPSHOT: i32 = 2;

/// Result of a nonblocking [`Server::poll`] call.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PollEvent {
    /// No connection or client request was ready during this poll.
    Idle,
    /// A client connected and received its initial menu snapshot.
    Connected,
    /// A client submitted one complete command batch and received the next snapshot.
    Exchange,
    /// The previous client disconnected or sent a malformed pipe message.
    Disconnected,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ConnectionState {
    AwaitConnection,
    AwaitRequest,
}

struct Mapping {
    handle: HANDLE,
    view: NonNull<u8>,
}

impl Mapping {
    unsafe fn create(name: &CString, bytes: usize) -> io::Result<(Self, bool)> {
        let bytes = u32::try_from(bytes)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "mapping is too large"))?;
        let handle = unsafe {
            CreateFileMappingA(
                INVALID_HANDLE_VALUE,
                ptr::null_mut(),
                PAGE_READWRITE,
                0,
                bytes,
                name.as_ptr(),
            )
        };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        let already_exists =
            unsafe { GetLastError() } == winapi::shared::winerror::ERROR_ALREADY_EXISTS;
        let view =
            unsafe { MapViewOfFile(handle, FILE_MAP_READ | FILE_MAP_WRITE, 0, 0, bytes as usize) };
        let Some(view) = NonNull::new(view.cast()) else {
            let error = io::Error::last_os_error();
            unsafe { CloseHandle(handle) };
            return Err(error);
        };
        Ok((Self { handle, view }, already_exists))
    }

    unsafe fn as_mut<T>(&mut self) -> &mut T {
        unsafe { &mut *self.view.as_ptr().cast::<T>() }
    }

    fn as_ptr<T>(&self) -> *mut T {
        self.view.as_ptr().cast::<T>()
    }
}

impl Drop for Mapping {
    fn drop(&mut self) {
        unsafe {
            UnmapViewOfFile(self.view.as_ptr().cast());
            CloseHandle(self.handle);
        }
    }
}

/// A BWAPI 4.4-compatible server endpoint in the StarCraft process.
///
/// Its default Windows DACL permits clients running as this user, which is the supported first
/// deployment model. Do not broaden it to `Everyone`: `GameData` is writable command input.
pub struct Server {
    process_id: u32,
    game_table: Mapping,
    game_data: Mapping,
    pipe: HANDLE,
    game_table_index: usize,
    state: ConnectionState,
}

impl Server {
    /// Creates the discovery mapping, process-specific game mapping, and nonblocking message pipe.
    pub fn new(instance: Option<&str>) -> io::Result<Self> {
        let process_id = unsafe { GetCurrentProcessId() };
        let table_name = game_table_mapping_name(instance)?;
        let data_name = CString::new(format!("Local\\bwapi_shared_memory_{process_id}")).unwrap();
        let pipe_name = CString::new(format!(r"\\.\pipe\bwapi_pipe_{process_id}")).unwrap();

        let (mut game_data, data_existed) =
            unsafe { Mapping::create(&data_name, size_of::<GameData>()) }?;
        if data_existed {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "a BWAPI endpoint already exists for this process",
            ));
        }
        let data = unsafe { game_data.as_mut::<GameData>() };
        unsafe { ptr::write_bytes(data, 0, 1) };
        data.client_version = CLIENT_VERSION;

        let pipe = unsafe {
            CreateNamedPipeA(
                pipe_name.as_ptr(),
                PIPE_ACCESS_DUPLEX,
                PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_NOWAIT,
                1,
                PIPE_BUFFER_SIZE,
                PIPE_BUFFER_SIZE,
                PIPE_DEFAULT_TIMEOUT_MS,
                ptr::null_mut(),
            )
        };
        if pipe == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }

        let reservation = (|| {
            // Windows zero-initializes a newly created mapping. Do not clear it after publication:
            // another process may already have reserved one of its rows.
            let (game_table, _) = unsafe { Mapping::create(&table_name, size_of::<GameTable>()) }?;
            let index = unsafe {
                reserve_game_table_slot(game_table.as_ptr(), process_id, process_exited)
            }?;
            Ok::<_, io::Error>((game_table, index))
        })();
        let (game_table, game_table_index) = match reservation {
            Ok(value) => value,
            Err(error) => {
                unsafe { CloseHandle(pipe) };
                return Err(error);
            }
        };

        Ok(Self {
            process_id,
            game_table,
            game_data,
            pipe,
            game_table_index,
            state: ConnectionState::AwaitConnection,
        })
    }

    /// Advances the named-pipe state machine without blocking.
    ///
    /// On `Connected`, `exchange` must produce a complete menu snapshot. On `Exchange`, it must
    /// first validate and consume client-owned input (using [`GameData::inbound_counts`]), then
    /// clear it and write the complete server-owned snapshot before this method returns.
    pub fn poll(&mut self, exchange: impl FnOnce(&mut GameData, bool)) -> io::Result<PollEvent> {
        self.refresh_game_table();

        match self.state {
            ConnectionState::AwaitConnection => {
                if !self.try_connect()? {
                    return Ok(PollEvent::Idle);
                }

                self.reset_game_data();
                exchange(self.game_data_mut(), true);
                match self.publish_snapshot()? {
                    PublishResult::Published => Ok(PollEvent::Connected),
                    PublishResult::Disconnected => Ok(PollEvent::Disconnected),
                }
            }
            ConnectionState::AwaitRequest => match self.try_read_request()? {
                RequestResult::Idle => Ok(PollEvent::Idle),
                RequestResult::Disconnected => Ok(PollEvent::Disconnected),
                RequestResult::Request => {
                    exchange(self.game_data_mut(), false);
                    match self.publish_snapshot()? {
                        PublishResult::Published => Ok(PollEvent::Exchange),
                        PublishResult::Disconnected => Ok(PollEvent::Disconnected),
                    }
                }
            },
        }
    }

    fn game_data_mut(&mut self) -> &mut GameData {
        unsafe { self.game_data.as_mut() }
    }

    fn refresh_game_table(&mut self) {
        let slot = unsafe { game_table_slot(self.game_table.as_ptr(), self.game_table_index) };
        unsafe {
            ptr::write_volatile(
                &raw mut (*slot).is_connected,
                u8::from(self.state == ConnectionState::AwaitRequest),
            );
            ptr::write_volatile(&raw mut (*slot).last_keep_alive_time, GetTickCount());
        }
    }

    fn reset_game_data(&mut self) {
        let data = self.game_data.as_ptr::<GameData>();
        unsafe {
            // Clients inspect this version before waiting for the first pipe response.
            ptr::write_volatile(&raw mut (*data).client_version, CLIENT_VERSION);
            ptr::write_bytes(
                data.cast::<u8>().add(size_of::<i32>()),
                0,
                size_of::<GameData>() - size_of::<i32>(),
            );
        }
    }

    fn try_connect(&mut self) -> io::Result<bool> {
        let connected = unsafe { ConnectNamedPipe(self.pipe, ptr::null_mut()) };
        if connected != FALSE {
            self.state = ConnectionState::AwaitRequest;
            self.refresh_game_table();
            return Ok(true);
        }

        match unsafe { GetLastError() } {
            ERROR_PIPE_CONNECTED => {
                self.state = ConnectionState::AwaitRequest;
                self.refresh_game_table();
                Ok(true)
            }
            ERROR_PIPE_LISTENING => Ok(false),
            ERROR_NO_DATA => {
                unsafe { DisconnectNamedPipe(self.pipe) };
                Ok(false)
            }
            _ => Err(io::Error::last_os_error()),
        }
    }

    fn try_read_request(&mut self) -> io::Result<RequestResult> {
        let mut bytes = [0_u8; size_of::<i32>()];
        let mut read = 0;
        let ok = unsafe {
            ReadFile(
                self.pipe,
                bytes.as_mut_ptr().cast::<_>(),
                bytes.len() as DWORD,
                &mut read,
                ptr::null_mut(),
            )
        };
        if ok == FALSE {
            return match unsafe { GetLastError() } {
                ERROR_NO_DATA => Ok(RequestResult::Idle),
                ERROR_BROKEN_PIPE | ERROR_MORE_DATA => Ok(self.reset_connection()),
                _ => Err(io::Error::last_os_error()),
            };
        }
        let valid_request = (read == 1 && bytes[0] == CLIENT_REQUEST as u8)
            || (read == bytes.len() as DWORD && i32::from_le_bytes(bytes) == CLIENT_REQUEST);
        if !valid_request {
            return Ok(self.reset_connection());
        }
        Ok(RequestResult::Request)
    }

    fn publish_snapshot(&mut self) -> io::Result<PublishResult> {
        let bytes = SERVER_SNAPSHOT.to_le_bytes();
        let mut written = 0;
        let ok = unsafe {
            WriteFile(
                self.pipe,
                bytes.as_ptr().cast::<_>(),
                bytes.len() as DWORD,
                &mut written,
                ptr::null_mut(),
            )
        };
        if ok == FALSE || written != bytes.len() as DWORD {
            return match unsafe { GetLastError() } {
                ERROR_BROKEN_PIPE | ERROR_NO_DATA => Ok(match self.reset_connection() {
                    RequestResult::Disconnected => PublishResult::Disconnected,
                    _ => unreachable!(),
                }),
                _ => Err(io::Error::last_os_error()),
            };
        }
        Ok(PublishResult::Published)
    }

    fn reset_connection(&mut self) -> RequestResult {
        unsafe { DisconnectNamedPipe(self.pipe) };
        self.state = ConnectionState::AwaitConnection;
        self.refresh_game_table();
        RequestResult::Disconnected
    }
}

fn game_table_mapping_name(instance: Option<&str>) -> io::Result<CString> {
    let mut name = String::from("Local\\bwapi_shared_memory_game_list");
    if let Some(instance) = instance {
        name.push('_');
        name.push_str(instance);
    }
    CString::new(name).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "BWAPI discovery instance contains a null byte",
        )
    })
}

impl Drop for Server {
    fn drop(&mut self) {
        unsafe {
            DisconnectNamedPipe(self.pipe);
            CloseHandle(self.pipe);
        }
        let slot = unsafe { game_table_slot(self.game_table.as_ptr(), self.game_table_index) };
        unsafe {
            let owner = &*(&raw const (*slot).server_process_id).cast::<AtomicU32>();
            if owner.load(Ordering::Acquire) == self.process_id {
                ptr::write_volatile(&raw mut (*slot).is_connected, 0);
                ptr::write_volatile(&raw mut (*slot).last_keep_alive_time, 0);
                let _ =
                    owner.compare_exchange(self.process_id, 0, Ordering::AcqRel, Ordering::Acquire);
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RequestResult {
    Idle,
    Request,
    Disconnected,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PublishResult {
    Published,
    Disconnected,
}

unsafe fn game_table_slot(table: *mut GameTable, index: usize) -> *mut GameInstance {
    debug_assert!(index < MAX_GAME_INSTANCES);
    unsafe {
        (&raw mut (*table).game_instances)
            .cast::<GameInstance>()
            .add(index)
    }
}

fn process_exited(process_id: u32) -> bool {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, process_id);
        if process.is_null() {
            // Access denied is not evidence that another user's game has exited.
            return GetLastError() == winapi::shared::winerror::ERROR_INVALID_PARAMETER;
        }
        let mut code = STILL_ACTIVE;
        let succeeded = GetExitCodeProcess(process, &mut code) != FALSE;
        CloseHandle(process);
        succeeded && code != STILL_ACTIVE
    }
}

unsafe fn reserve_game_table_slot(
    table: *mut GameTable,
    process_id: u32,
    is_dead: impl Fn(u32) -> bool,
) -> io::Result<usize> {
    for index in 0..MAX_GAME_INSTANCES {
        unsafe {
            let slot = game_table_slot(table, index);
            let owner = &*(&raw const (*slot).server_process_id).cast::<AtomicU32>();
            let previous = owner.load(Ordering::Acquire);
            if previous != 0 && !is_dead(previous) {
                continue;
            }
            if owner
                .compare_exchange(previous, process_id, Ordering::AcqRel, Ordering::Acquire)
                .is_ok()
            {
                ptr::write_volatile(&raw mut (*slot).is_connected, 0);
                ptr::write_volatile(&raw mut (*slot).last_keep_alive_time, GetTickCount());
                return Ok(index);
            }
        }
    }
    Err(io::Error::other(
        "all BWAPI discovery slots are occupied by live processes",
    ))
}

#[cfg(test)]
mod tests {
    use std::{
        ffi::CString,
        io,
        mem::size_of,
        ptr::{self, NonNull},
        sync::Mutex,
    };

    use super::*;
    use winapi::{
        shared::{
            minwindef::{DWORD, FALSE},
            winerror::ERROR_MORE_DATA,
        },
        um::{
            errhandlingapi::GetLastError,
            fileapi::{CreateFileA, OPEN_EXISTING, ReadFile, WriteFile},
            handleapi::{CloseHandle, INVALID_HANDLE_VALUE},
            memoryapi::{FILE_MAP_READ, FILE_MAP_WRITE, MapViewOfFile, UnmapViewOfFile},
            namedpipeapi::PeekNamedPipe,
            winbase::OpenFileMappingA,
            winnt::{GENERIC_READ, GENERIC_WRITE, HANDLE},
        },
    };

    static TRANSPORT_TEST_LOCK: Mutex<()> = Mutex::new(());

    struct Client {
        pipe: HANDLE,
        table_handle: HANDLE,
        table: NonNull<GameTable>,
        data_handle: HANDLE,
        data: NonNull<GameData>,
    }

    impl Client {
        fn connect(process_id: u32) -> io::Result<Self> {
            let table_name = CString::new("Local\\bwapi_shared_memory_game_list").unwrap();
            let data_name =
                CString::new(format!("Local\\bwapi_shared_memory_{process_id}")).unwrap();
            let pipe_name = CString::new(format!(r"\\.\pipe\bwapi_pipe_{process_id}")).unwrap();
            let pipe = unsafe {
                CreateFileA(
                    pipe_name.as_ptr(),
                    GENERIC_READ | GENERIC_WRITE,
                    0,
                    ptr::null_mut(),
                    OPEN_EXISTING,
                    0,
                    ptr::null_mut(),
                )
            };
            if pipe == INVALID_HANDLE_VALUE {
                return Err(io::Error::last_os_error());
            }

            let (table_handle, table) = match open_mapping::<GameTable>(&table_name) {
                Ok(mapping) => mapping,
                Err(error) => {
                    unsafe { CloseHandle(pipe) };
                    return Err(error);
                }
            };
            let (data_handle, data) = match open_mapping::<GameData>(&data_name) {
                Ok(mapping) => mapping,
                Err(error) => {
                    unsafe {
                        UnmapViewOfFile(table.as_ptr().cast());
                        CloseHandle(table_handle);
                        CloseHandle(pipe);
                    }
                    return Err(error);
                }
            };
            Ok(Self {
                pipe,
                table_handle,
                table,
                data_handle,
                data,
            })
        }

        fn data(&self) -> &GameData {
            unsafe { self.data.as_ref() }
        }

        fn data_mut(&mut self) -> &mut GameData {
            unsafe { self.data.as_mut() }
        }

        fn table(&self) -> &GameTable {
            unsafe { self.table.as_ref() }
        }

        fn write_message(&self, bytes: &[u8]) -> io::Result<()> {
            let mut written = 0;
            let ok = unsafe {
                WriteFile(
                    self.pipe,
                    bytes.as_ptr().cast(),
                    bytes
                        .len()
                        .try_into()
                        .map_err(|_| io::Error::other("test message is too large"))?,
                    &mut written,
                    ptr::null_mut(),
                )
            };
            if ok == FALSE {
                return Err(io::Error::last_os_error());
            }
            if written != bytes.len() as DWORD {
                return Err(io::Error::new(io::ErrorKind::WriteZero, "short pipe write"));
            }
            Ok(())
        }

        fn read_snapshot(&self) -> io::Result<i32> {
            let mut available = 0;
            let peeked = unsafe {
                PeekNamedPipe(
                    self.pipe,
                    ptr::null_mut(),
                    0,
                    ptr::null_mut(),
                    &mut available,
                    ptr::null_mut(),
                )
            };
            if peeked == FALSE {
                return Err(io::Error::last_os_error());
            }
            if available != size_of::<i32>() as DWORD {
                return Err(io::Error::new(
                    io::ErrorKind::WouldBlock,
                    "snapshot was not ready",
                ));
            }

            let mut bytes = [0; size_of::<i32>()];
            let mut read = 0;
            let ok = unsafe {
                ReadFile(
                    self.pipe,
                    bytes.as_mut_ptr().cast(),
                    bytes.len() as DWORD,
                    &mut read,
                    ptr::null_mut(),
                )
            };
            if ok == FALSE {
                return Err(io::Error::last_os_error());
            }
            if read != bytes.len() as DWORD {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "short pipe snapshot",
                ));
            }
            Ok(i32::from_le_bytes(bytes))
        }

        fn read_java_snapshot(&self) -> io::Result<()> {
            for _ in 0..8 {
                let mut byte = 0;
                let mut read = 0;
                let ok = unsafe {
                    ReadFile(
                        self.pipe,
                        (&raw mut byte).cast(),
                        size_of::<u8>() as DWORD,
                        &mut read,
                        ptr::null_mut(),
                    )
                };
                if ok == FALSE && unsafe { GetLastError() } != ERROR_MORE_DATA {
                    return Err(io::Error::last_os_error());
                }
                if read != size_of::<u8>() as DWORD {
                    return Err(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "short Java pipe read",
                    ));
                }
                if byte == SERVER_SNAPSHOT as u8 {
                    return Ok(());
                }
            }
            Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Java byte stream did not reach a snapshot marker",
            ))
        }
    }

    impl Drop for Client {
        fn drop(&mut self) {
            unsafe {
                UnmapViewOfFile(self.data.as_ptr().cast());
                CloseHandle(self.data_handle);
                UnmapViewOfFile(self.table.as_ptr().cast());
                CloseHandle(self.table_handle);
                CloseHandle(self.pipe);
            }
        }
    }

    fn open_mapping<T>(name: &CString) -> io::Result<(HANDLE, NonNull<T>)> {
        let handle =
            unsafe { OpenFileMappingA(FILE_MAP_READ | FILE_MAP_WRITE, FALSE, name.as_ptr()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        let view =
            unsafe { MapViewOfFile(handle, FILE_MAP_READ | FILE_MAP_WRITE, 0, 0, size_of::<T>()) };
        let Some(view) = NonNull::new(view.cast()) else {
            let error = io::Error::last_os_error();
            unsafe { CloseHandle(handle) };
            return Err(error);
        };
        Ok((handle, view))
    }

    #[test]
    fn discovery_mapping_name_uses_instance_suffix_only_when_requested() {
        assert_eq!(
            game_table_mapping_name(None).unwrap().to_bytes(),
            b"Local\\bwapi_shared_memory_game_list",
        );
        assert_eq!(
            game_table_mapping_name(Some("bot-17")).unwrap().to_bytes(),
            b"Local\\bwapi_shared_memory_game_list_bot-17",
        );
    }

    #[test]
    fn real_pipe_and_mapping_handshake_disconnect_and_reconnect() {
        let _lock = TRANSPORT_TEST_LOCK.lock().unwrap();
        let mut server = Server::new(None).unwrap();
        assert_eq!(server.poll(|_, _| unreachable!()).unwrap(), PollEvent::Idle);

        let mut client = Client::connect(server.process_id).unwrap();
        // The upstream client reads this field immediately after mapping and before waiting for 2.
        assert_eq!(client.data().client_version, CLIENT_VERSION);
        let slot = &client.table().game_instances[server.game_table_index];
        assert_eq!(slot.server_process_id, server.process_id);
        assert_eq!(slot.is_connected, 0);

        assert_eq!(
            server
                .poll(|data, initial| {
                    assert!(initial);
                    data.frame_count = 7;
                })
                .unwrap(),
            PollEvent::Connected
        );
        assert_eq!(client.read_snapshot().unwrap(), SERVER_SNAPSHOT);
        assert_eq!(client.data().client_version, CLIENT_VERSION);
        assert_eq!(client.data().frame_count, 7);
        assert_eq!(
            client.table().game_instances[server.game_table_index].is_connected,
            1
        );
        assert_eq!(server.poll(|_, _| unreachable!()).unwrap(), PollEvent::Idle);

        client.write_message(&CLIENT_REQUEST.to_le_bytes()).unwrap();
        client.data_mut().command_count = 0;
        assert_eq!(
            server
                .poll(|data, initial| {
                    assert!(!initial);
                    data.frame_count = 8;
                })
                .unwrap(),
            PollEvent::Exchange
        );
        assert_eq!(client.read_snapshot().unwrap(), SERVER_SNAPSHOT);
        assert_eq!(client.data().frame_count, 8);

        drop(client);
        assert_eq!(
            server.poll(|_, _| unreachable!()).unwrap(),
            PollEvent::Disconnected
        );
        let slot =
            unsafe { &*game_table_slot(server.game_table.as_ptr(), server.game_table_index) };
        assert_eq!(slot.is_connected, 0);

        assert_eq!(server.poll(|_, _| unreachable!()).unwrap(), PollEvent::Idle);

        let client = Client::connect(server.process_id).unwrap();
        assert_eq!(
            server
                .poll(|data, initial| {
                    assert!(initial);
                    data.frame_count = 9;
                })
                .unwrap(),
            PollEvent::Connected
        );
        assert_eq!(client.read_snapshot().unwrap(), SERVER_SNAPSHOT);
        assert_eq!(
            client.table().game_instances[server.game_table_index].is_connected,
            1
        );

        // A message larger than the four-byte protocol code makes ReadFile return ERROR_MORE_DATA.
        client.write_message(&[1, 0, 0, 0, 0]).unwrap();
        assert_eq!(
            server.poll(|_, _| unreachable!()).unwrap(),
            PollEvent::Disconnected
        );
        assert_eq!(
            unsafe {
                (*game_table_slot(server.game_table.as_ptr(), server.game_table_index)).is_connected
            },
            0
        );
        drop(client);

        assert_eq!(server.poll(|_, _| unreachable!()).unwrap(), PollEvent::Idle);

        let client = Client::connect(server.process_id).unwrap();
        assert_eq!(
            server
                .poll(|data, initial| {
                    assert!(initial);
                    data.frame_count = 10;
                })
                .unwrap(),
            PollEvent::Connected
        );
        assert_eq!(client.read_snapshot().unwrap(), SERVER_SNAPSHOT);
    }

    #[test]
    fn java_one_byte_requests_preserve_snapshot_byte_stream_and_reject_bad_widths() {
        let _lock = TRANSPORT_TEST_LOCK.lock().unwrap();
        let mut server = Server::new(None).unwrap();
        let client = Client::connect(server.process_id).unwrap();

        assert_eq!(
            server
                .poll(|data, initial| {
                    assert!(initial);
                    data.frame_count = 1;
                })
                .unwrap(),
            PollEvent::Connected
        );
        // The first response remains the native four-byte snapshot message.
        assert_eq!(client.read_snapshot().unwrap(), SERVER_SNAPSHOT);

        client.write_message(&[CLIENT_REQUEST as u8]).unwrap();
        assert_eq!(
            server
                .poll(|data, initial| {
                    assert!(!initial);
                    data.frame_count = 2;
                })
                .unwrap(),
            PollEvent::Exchange
        );
        // JBWAPI reads one byte at a time, retaining the three zero bytes in this message.
        client.read_java_snapshot().unwrap();

        client.write_message(&[CLIENT_REQUEST as u8]).unwrap();
        assert_eq!(
            server
                .poll(|data, initial| {
                    assert!(!initial);
                    data.frame_count = 3;
                })
                .unwrap(),
            PollEvent::Exchange
        );
        // This consumes the retained zeroes before the next four-byte snapshot marker.
        client.read_java_snapshot().unwrap();
        assert_eq!(client.data().frame_count, 3);

        client.write_message(&[1, 0]).unwrap();
        assert_eq!(
            server.poll(|_, _| unreachable!()).unwrap(),
            PollEvent::Disconnected
        );
        drop(client);
        assert_eq!(server.poll(|_, _| unreachable!()).unwrap(), PollEvent::Idle);

        let client = Client::connect(server.process_id).unwrap();
        assert_eq!(
            server.poll(|_, initial| assert!(initial)).unwrap(),
            PollEvent::Connected
        );
        assert_eq!(client.read_snapshot().unwrap(), SERVER_SNAPSHOT);
        client.write_message(&[1, 0, 0]).unwrap();
        assert_eq!(
            server.poll(|_, _| unreachable!()).unwrap(),
            PollEvent::Disconnected
        );
        drop(client);
        assert_eq!(server.poll(|_, _| unreachable!()).unwrap(), PollEvent::Idle);

        let client = Client::connect(server.process_id).unwrap();
        assert_eq!(
            server.poll(|_, initial| assert!(initial)).unwrap(),
            PollEvent::Connected
        );
        assert_eq!(client.read_snapshot().unwrap(), SERVER_SNAPSHOT);
        client.write_message(&[SERVER_SNAPSHOT as u8]).unwrap();
        assert_eq!(
            server.poll(|_, _| unreachable!()).unwrap(),
            PollEvent::Disconnected
        );
    }

    #[test]
    fn full_live_table_is_not_evicted() {
        let mut table = GameTable::default();
        for (index, instance) in table.game_instances.iter_mut().enumerate() {
            instance.server_process_id = index as u32 + 1;
        }
        assert!(unsafe { reserve_game_table_slot(&raw mut table, 99, |_| false) }.is_err());
        assert_eq!(table.game_instances[0].server_process_id, 1);
        assert_eq!(table.game_instances[7].server_process_id, 8);
    }

    #[test]
    fn reclaims_only_confirmed_dead_processes() {
        let mut table = GameTable::default();
        for (index, instance) in table.game_instances.iter_mut().enumerate() {
            instance.server_process_id = index as u32 + 1;
        }
        assert_eq!(
            unsafe { reserve_game_table_slot(&raw mut table, 99, |id| id == 4) }.unwrap(),
            3
        );
        assert_eq!(table.game_instances[3].server_process_id, 99);
        assert_eq!(table.game_instances[2].server_process_id, 3);
    }
}
