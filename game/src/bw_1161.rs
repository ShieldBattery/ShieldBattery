#![allow(non_upper_case_globals, non_camel_case_types)]

mod observing;
mod snp;
mod storm;

use std::io;
use std::ffi::{CStr, OsStr};
use std::path::{Path, PathBuf};
use std::ptr::null_mut;

use libc::c_void;
use winapi::um::winnt::HANDLE;

use crate::bw::{self, FowSpriteIterator, StormPlayerId};
use crate::bw::unit::{Unit, UnitIterator};
use crate::chat;
use crate::game_thread;
use crate::windows;

pub struct Bw1161;

mod v1161 {
    use crate::bw;

    #[repr(C, packed)]
    pub struct Sprite {
        pub prev: *mut Sprite,
        pub next: *mut Sprite,
        pub sprite_id: u16,
        pub player: u8,
        pub selection_index: u8,
        pub visibility_mask: u8,
        pub elevation_level: u8,
        pub flags: u8,
        pub selection_flash_timer: u8,
        pub index: u16,
        pub width: u8,
        pub height: u8,
        pub pos_x: i16,
        pub pos_y: i16,
        pub main_image: *mut bw::Image,
        pub first_image: *mut bw::Image,
        pub last_image: *mut bw::Image,
    }

    #[test]
    fn struct_sizes() {
        use std::mem::size_of;
        assert_eq!(size_of::<Sprite>(), 0x24);
    }
}

impl bw::Bw for Bw1161 {
    unsafe fn run_game_loop(&self) {
        *vars::game_state = 3; // Playing
        game_loop();
    }

    unsafe fn clean_up_for_exit(&self) {
        clean_up_for_exit(0);
    }

    unsafe fn init_sprites(&self) {
        init_sprites();
    }

    unsafe fn maybe_receive_turns(&self) {
        maybe_receive_turns();
    }

    unsafe fn init_game_network(&self) {
        init_game_network();
    }

    unsafe fn init_network_player_info(&self, storm_player_id: u32) {
        init_network_player_info(storm_player_id, 0, 1, 5);
    }

    unsafe fn do_lobby_game_init(&self, seed: u32) {
        update_nation_and_human_ids(*vars::local_storm_id);
        *vars::lobby_state = 8;
        let data = bw::LobbyGameInitData {
            game_init_command: 0x48,
            random_seed: seed,
            // TODO(tec27): deal with player bytes if we ever allow save games
            player_bytes: [8; 8],
        };
        // We ask bw to handle lobby game init packet that was sent by host (storm id 0)
        on_lobby_game_init(0, &data);
    }

    unsafe fn try_finish_lobby_game_init(&self) -> bool {
        *vars::lobby_state = 9;
        true
    }

    unsafe fn create_lobby(
        &self,
        map_path: &Path,
        lobby_name: &str,
        game_type: bw::GameType,
    ) -> Result<(), bw::LobbyCreateError> {
        create_lobby(map_path, lobby_name, game_type)
    }

    unsafe fn join_lobby(
        &self,
        game_info: &mut bw::JoinableGameInfo,
        map_path: &[u8],
        _address: std::net::Ipv4Addr,
    ) -> Result<(), u32> {
        assert!(*map_path.last().unwrap() == 0, "Map path was not null-terminated");
        let ok = join_game(game_info);
        if ok == 0 {
            return Err(storm::SErrGetLastError());
        }
        let mut out = [0u32; 8];
        let ok = init_map_from_path(map_path.as_ptr(), out.as_mut_ptr() as *mut c_void, 0);
        if ok == 0 {
            return Err(storm::SErrGetLastError());
        }
        init_team_game_playable_slots();
        Ok(())
    }

    unsafe fn remaining_game_init(&self, name_in: &str) {
        let name = windows::ansi_codepage_cstring(&name_in).unwrap_or_else(|e| e);
        for (&input, out) in name.iter().zip(vars::local_player_name.iter_mut()) {
            *out = input;
        }
        choose_network_provider(crate::snp::PROVIDER_ID);
        *vars::is_multiplayer = 1;
    }

    unsafe fn game(&self) -> *mut bw::Game {
        &mut *vars::game
    }

    unsafe fn players(&self) -> *mut bw::Player {
        (*vars::players).as_mut_ptr()
    }

    unsafe fn replay_data(&self) -> *mut bw::ReplayData {
        *vars::replay_data
    }

    fn game_command_lengths(&self) -> &[u32] {
        // Copypasted to contain also SCR commands as of 1.23.7,
        // doesn't hurt and would have to be done ever if 1.16.1 was
        // improved to support them in replays and ingame.
        static LENGTHS: &[u32] = &[
            !0, !0, !0, !0, !0, 1, 33, 33, 1, 26, 26, 26, 8, 3, 5, 2,
            1, 1, 5, 3, 10, 11, !0, !0, 1, 1, 2, 1, 1, 1, 2, 3,
            3, 2, 2, 3, 1, 2, 2, 1, 2, 3, 1, 2, 2, 2, 1, 5,
            2, 1, 2, 1, 1, 3, 1, 1, !0, !0, !0, !0, !0, !0, !0, !0,
            !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0,
            !0, !0, !0, !0, !0, 2, 10, 2, 5, !0, 1, !0, 82, 5, !0, 2,
            12, 13, 5, 50, 50, 50, 4, !0, !0, !0, !0, !0, !0, !0, !0, !0,
        ];
        LENGTHS
    }

    unsafe fn process_replay_commands(&self, commands: &[u8], storm_player: StormPlayerId) {
        let players = self.players();
        let game = self.game();
        let unique_player = match (0..8)
            .position(|i| (*players.add(i)).storm_id as u8 == storm_player.0)
        {
            Some(s) => s as u8,
            None => return,
        };
        let game_player = if game_thread::is_team_game() {
            // Teams start from 1
            let team = (*players.add(unique_player as usize)).team;
            (*game).team_game_main_player[team as usize - 1]
        } else {
            unique_player
        };
        *vars::command_user = game_player as u32;
        *vars::unique_command_user = unique_player as u32;
        *vars::enable_rng = 1;
        process_commands(commands.as_ptr(), commands.len() as u32, 1);
        *vars::command_user = *vars::local_nation_id;
        *vars::unique_command_user = *vars::local_unique_player_id;
        *vars::enable_rng = 0;
    }

    unsafe fn set_player_name(&self, id: u8, name: &str) {
        let mut buffer = [0; 25];
        for (i, &byte) in name.as_bytes().iter().take(24).enumerate() {
            buffer[i] = byte;
        }
        (*self.players().add(id as usize)).name = buffer;
    }

    unsafe fn active_units(&self) -> UnitIterator {
        UnitIterator::new(Unit::from_ptr(*vars::first_active_unit))
    }

    unsafe fn fow_sprites(&self) -> FowSpriteIterator {
        FowSpriteIterator::new(*vars::first_fow_sprite)
    }

    unsafe fn create_fow_sprite(&self, unit: Unit) {
        create_fow_sprite((**unit).unit_id as u32, (**unit).sprite);
    }

    unsafe fn sprite_position(&self, sprite: *mut c_void) -> bw::Point {
        let sprite = sprite as *mut v1161::Sprite;
        bw::Point {
            x: (*sprite).pos_x,
            y: (*sprite).pos_y,
        }
    }

    unsafe fn storm_players(&self) -> Vec<bw::StormPlayer> {
        (*vars::storm_players)[..].into()
    }

    unsafe fn storm_player_flags(&self) -> Vec<u32> {
        (*vars::storm_player_flags)[..].into()
    }

    unsafe fn storm_set_last_error(&self, error: u32) {
        storm::SErrSetLastError(error);
    }
}

impl Bw1161 {
    pub unsafe fn patch_game(&'static self) {
        patch_game(self);
    }
}

whack_hooks!(stdcall, 0x00400000,
    0x004E0AE0 => WinMain(*mut c_void, *mut c_void, *const u8, i32) -> i32;
    0x004E08A5 => GameInit();
    0x0047F8F0 => ChatCommand(*const u8);
    0x0047F0E0 => ScrollScreen();

    0x004A5230 => MinimapCtrl_InitButton(@eax *mut bw::Control);
    0x004913D0 => MinimapCtrl_ShowAllianceDialog();
    0x004A5200 => DrawMinimap();
    0x004A4E00 => Minimap_TimerRefresh();
    0x0041CA00 => RedrawScreen();
    0x00491310 => AllianceDialog_EventHandler(@ecx *mut bw::Control, @edx *mut bw::UiEvent) -> u32;
    0x0046FEA0 => GameScreenLeftClick(@ecx *mut c_void);
    0x0048EC10 => PlaySoundAtPos(@ebx u32, u32, u32, u32);
    0x004865D0 => ProcessCommands(@eax *const u8, u32, u32);
    0x0047CDD0 => Command_Sync(@edi *const u8) -> u32;
    0x00485F50 => ChatMessage(@ecx u32, @edx *const u8, u32) -> u32;
    0x004194E0 => LoadDialog(@eax *mut bw::Dialog, @ebx *mut c_void, *mut c_void, *const u8, u32);
    0x004EE180 => InitUiVariables();
    0x00458120 => DrawStatusScreen();
    0x004591D0 => UpdateCommandCard();
    0x004598D0 => CmdBtn_EventHandler(@ecx *mut bw::Control, @edx *mut bw::UiEvent) -> u32;
    0x00458900 => DrawCommandButton(@ecx *mut bw::Control, @edx i32, i32, *mut c_void);
    0x004E5640 => DrawResourceCounts(@ecx *mut bw::Control, @edx *mut c_void);
    0x004DDD30 => GetGluAllString(u32) -> *const u8;
    0x004A2D60 => UpdateNetTimeoutPlayers();
    0x004CB190 =>
        CenterScreenOnOwnStartLocation(@eax *mut bw::PreplacedUnit, @ecx *mut c_void) -> u32;
    0x004EF100 => InitGameData() -> u32;
    0x0049F380 => InitUnitData();
    0x004D94B0 => StepGame();
    0x00487100 => StepReplayCommands();
);

whack_funcs!(stdcall, init_funcs, 0x00400000,
    0x004D7390 => init_sprites();
    0x004D3CC0 => choose_network_provider(@ebx u32);
    0x004A8050 => select_map_or_directory(
        // game_name, password, game_type, speed, directory, map entry
        *const u8, *const u8, u32, u32, *const u8, @eax *mut bw::MapListEntry
    ) -> u32;
    0x004A73C0 => get_maps_list(
        // flags, directory, last_map_name, callback(entry, name, flags) -> listbox_index
        u32, *const u8, *const u8,
        @eax unsafe extern "stdcall" fn(*mut bw::MapListEntry, *const u8, u32) -> u32,
    );
    0x004D4130 => init_game_network();
    0x00472110 => on_lobby_game_init(@eax u32, @edx *const bw::LobbyGameInitData);
    0x004A8D40 => update_nation_and_human_ids(@esi u32);
    0x00470D10 => init_network_player_info(u32, u32, u32, u32);
    0x004E0710 => game_loop();
    0x004D3B50 => join_game(@ebx *mut bw::JoinableGameInfo) -> u32;
    0x004BF5D0 => init_map_from_path(*const u8, *mut c_void, u32) -> u32;
    0x00470150 => init_team_game_playable_slots();
    0x00486580 => maybe_receive_turns();
    0x004F3280 => send_multiplayer_chat_message(@eax *const u8);

    0x004CDE70 => add_to_replay_data(@eax *mut bw::ReplayData, @ebx *const u8, @edi u32, u32);
    0x0048D0C0 => display_message(@edi *const u8, @eax u32);
    0x004207B0 => clean_up_for_exit(@ebx u32);

    // Unit id, base sprite
    0x00488410 => create_fow_sprite(u32, *mut c_void) -> *mut bw::FowSprite;

    0x004865D0 => process_commands(@eax *const u8, u32, u32);
);

mod vars {
    use crate::bw;

    whack_vars!(init_vars, 0x00400000,
        0x0057F0F0 => game: bw::Game;
        0x0057EE9C => local_player_name: [u8; 25];
        0x0057F0B4 => is_multiplayer: u8;
        0x0059BB70 => current_map_folder_path: [u8; 260];
        0x0051A27C => map_list_root: *mut bw::MapListEntry;
        0x0057EEE0 => players: [bw::Player; 12];
        0x0066FE20 => storm_players: [bw::StormPlayer; 8];
        0x0051268C => local_storm_id: u32;
        0x00512684 => local_nation_id: u32;
        0x00512688 => local_unique_player_id: u32;
        0x0066FBFA => lobby_state: u8;
        0x00596904 => game_state: u32;
        0x0057F1DA => chat_message_recipients: u8;
        0x0068C144 => chat_message_type: u8;
        0x0057F0B8 => storm_player_flags: [u32; 8];

        0x00596BBC => replay_data: *mut bw::ReplayData;
        0x006D0F18 => replay_visions: u32;
        0x0057F0B0 => player_visions: u32;
        0x006CEB39 => resource_minimap_color: u8;
        0x006D5BC4 => timeout_bin: *mut bw::Dialog;
        0x006D0F14 => is_replay: u32;
        0x00597248 => primary_selected: *mut bw::Unit;
        0x0057EE7C => storm_id_to_human_id: [u32; 8];
        0x00512678 => current_command_player: u32;
        0x00628430 => first_active_unit: *mut bw::Unit;
        0x00654868 => first_fow_sprite: *mut bw::FowSprite;

        // Main player of the team in team melee
        0x00512678 => command_user: u32;
        0x0051267C => unique_command_user: u32;
        0x006D11C8 => enable_rng: u32;
    );
}

// Misc non-function-level patches
pub const INIT_SPRITES_RENDER_ONE: usize = 0x0047AEB1;
pub const INIT_SPRITES_RENDER_TWO: usize = 0x0047AFB1;

unsafe fn patch_game(bw: &'static Bw1161) {
    use observing::with_replay_flag_if_obs;

    whack_export!(pub extern "system" CreateEventA(*mut c_void, u32, u32, *const i8) -> *mut c_void);
    whack_export!(pub extern "system" DeleteFileA(*const i8) -> u32);
    whack_export!(pub extern "system"
        CreateFileA(*const i8, u32, u32, *mut c_void, u32, u32, *mut c_void) -> HANDLE
    );

    let mut active_patcher = crate::PATCHER.lock();
    crate::forge::init_hooks_1161(&mut active_patcher);
    snp::init_hooks(&mut active_patcher);

    let mut exe = active_patcher.patch_exe(0x0040_0000);
    init_funcs(&mut exe);
    vars::init_vars(&mut exe);
    exe.hook_opt(WinMain, entry_point_hook);
    exe.hook(GameInit, crate::process_init_hook);
    exe.hook_opt(ChatCommand, chat_command_hook);
    exe.hook_opt(ScrollScreen, scroll_screen);
    // Rendering during InitSprites is useless and wastes a bunch of time, so we no-op it
    exe.replace(INIT_SPRITES_RENDER_ONE, &[0x90, 0x90, 0x90, 0x90, 0x90]);
    exe.replace(INIT_SPRITES_RENDER_TWO, &[0x90, 0x90, 0x90, 0x90, 0x90]);

    exe.hook_closure(MinimapCtrl_InitButton, |a, orig| {
        with_replay_flag_if_obs(|| orig(a))
    });
    exe.hook_closure(MinimapCtrl_ShowAllianceDialog, |orig| {
        with_replay_flag_if_obs(|| orig())
    });
    exe.hook_closure(DrawMinimap, |orig| {
        with_replay_flag_if_obs(|| orig())
    });
    // Bw force refreshes the minimap every second?? why
    // And of course the DrawMinimap call in it is inlined so it has to be hooked separately.
    exe.hook_closure(Minimap_TimerRefresh, |orig| {
        with_replay_flag_if_obs(|| orig())
    });
    exe.hook_closure(RedrawScreen, |orig| {
        with_replay_flag_if_obs(|| orig())
    });
    exe.hook_closure(
        AllianceDialog_EventHandler,
        |a, b, orig| with_replay_flag_if_obs(|| orig(a, b)),
    );
    exe.hook_closure(GameScreenLeftClick, |a, orig| {
        with_replay_flag_if_obs(|| orig(a))
    });
    exe.hook_closure(PlaySoundAtPos, |a, b, c, d, orig| {
        with_replay_flag_if_obs(|| orig(a, b, c, d))
    });
    exe.hook_closure(DrawResourceCounts, |a, b, orig| {
        with_replay_flag_if_obs(|| orig(a, b))
    });
    exe.hook_opt(ProcessCommands, observing::process_commands_hook);
    exe.hook_opt(Command_Sync, observing::sync_command_hook);
    exe.hook_opt(ChatMessage, observing::chat_message_hook);
    exe.hook_opt(LoadDialog, observing::load_dialog_hook);
    exe.hook_opt(InitUiVariables, observing::init_ui_variables_hook);
    exe.hook_opt(UpdateCommandCard, observing::update_command_card_hook);
    exe.hook_opt(
        CmdBtn_EventHandler,
        observing::cmdbtn_event_handler_hook,
    );
    exe.hook_opt(DrawCommandButton, observing::draw_command_button_hook);
    exe.hook_opt(GetGluAllString, observing::get_gluall_string_hook);
    exe.hook_opt(
        UpdateNetTimeoutPlayers,
        observing::update_net_timeout_players,
    );
    exe.hook_opt(
        CenterScreenOnOwnStartLocation,
        observing::center_screen_on_start_location,
    );
    exe.hook_closure(InitGameData, |orig| {
        let ok = orig();
        if ok == 0 {
            error!("init_game_data failed");
            return 0;
        }
        game_thread::after_init_game_data();
        1
    });
    exe.hook_closure(InitUnitData, move |orig| {
        game_thread::before_init_unit_data(bw);
        orig();
    });
    exe.hook_closure(StepGame, |orig| {
        orig();
        game_thread::after_step_game();
    });
    exe.hook_closure(StepReplayCommands, |orig| {
        game_thread::step_replay_commands(orig);
    });

    exe.import_hook_opt(&b"kernel32"[..], CreateEventA, create_event_hook);
    exe.import_hook_opt(&b"kernel32"[..], DeleteFileA, delete_file_hook);
    exe.import_hook_opt(&b"kernel32"[..], CreateFileA, create_file_hook);

    // Check for a rare-but-dumb storm bug where the codegen for unrolled memcpy/blitting
    // does an OOB string read and ends up generating broken code.
    // (This data is initialized in storm's DllMain, so it has run already)
    let surface_copy_code_ptr = *storm::surface_copy_code;
    if !surface_copy_code_ptr.is_null() {
        let surface_copy_code = (*surface_copy_code_ptr).code_offsets[0xa0];
        if *surface_copy_code.add(1) != 6 {
            for i in 0..0xa0 {
                *surface_copy_code.add(i * 0x10 + 0x1) = 0x6;
                *surface_copy_code.add(i * 0x10 + 0x9) = 0x7;
            }
        }
    }
}

fn scroll_screen(orig: unsafe extern fn()) {
    if !crate::forge::input_disabled() {
        unsafe {
            orig();
        }
    }
}

unsafe fn create_event_hook(
    security: *mut c_void,
    init_state: u32,
    manual_reset: u32,
    name: *const i8,
    orig: unsafe extern fn(*mut c_void, u32, u32, *const i8) -> *mut c_void,
) -> *mut c_void {
    use winapi::um::errhandlingapi::SetLastError;
    if !name.is_null() {
        if CStr::from_ptr(name).to_str() == Ok("Starcraft Check For Other Instances") {
            // BW just checks last error to be ERROR_ALREADY_EXISTS
            SetLastError(0);
            return null_mut();
        }
    }
    orig(security, init_state, manual_reset, name)
}

fn ascii_path_filename(val: &[u8]) -> &[u8] {
    val.rsplit(|&x| x == b'/' || x == b'\\')
        .skip_while(|x| x.is_empty())
        .next()
        .unwrap_or_else(|| &[])
}

#[test]
fn test_ascii_path_filename() {
    assert_eq!(ascii_path_filename(b"asd/qwe/zxc"), b"zxc");
    assert_eq!(ascii_path_filename(b"asd/qwe/z/c/"), b"c");
    assert_eq!(ascii_path_filename(b"asd/qwe\\zxc.rep"), b"zxc.rep");
    assert_eq!(ascii_path_filename(b"asd\\qwe//zxc"), b"zxc");
    assert_eq!(ascii_path_filename(b"zxc"), b"zxc");
    assert_eq!(ascii_path_filename(b"\\zxc"), b"zxc");
    assert_eq!(ascii_path_filename(b"zxc///\\"), b"zxc");
    assert_eq!(ascii_path_filename(b"\\zxc\\"), b"zxc");
    assert_eq!(ascii_path_filename(b"\\/\\"), b"");
}

unsafe fn delete_file_hook(filename: *const i8, orig: unsafe extern fn(*const i8) -> u32) -> u32 {
    if ascii_path_filename(CStr::from_ptr(filename).to_bytes()) == b"LastReplay.rep" {
        // Before saving the last replay BW first tries to delete it, which can fail.
        // We no-op it since we're saving the last replay ourselves.
        1
    } else {
        orig(filename)
    }
}

unsafe fn create_file_hook(
    filename: *const i8,
    access: u32,
    share_mode: u32,
    security_attributes: *mut c_void,
    creation_disposition: u32,
    flags: u32,
    template: *mut c_void,
    orig: unsafe extern fn(*const i8, u32, u32, *mut c_void, u32, u32, *mut c_void) -> HANDLE,
) -> HANDLE {
    use winapi::um::fileapi::CreateFileW;
    use winapi::um::handleapi::INVALID_HANDLE_VALUE;

    if ascii_path_filename(CStr::from_ptr(filename).to_bytes()) != b"LastReplay.rep" {
        return orig(
            filename,
            access,
            share_mode,
            security_attributes,
            creation_disposition,
            flags,
            template,
        );
    }

    let documents_path = match get_documents_path() {
        Ok(o) => o,
        Err(e) => {
            error!("Couldn't retrieve user's document folder path: {}", e);
            return INVALID_HANDLE_VALUE;
        }
    };
    let replay_folder = documents_path.join("Starcraft\\maps\\replays\\Auto");
    if !replay_folder.is_dir() {
        if let Err(e) = std::fs::create_dir_all(&replay_folder) {
            error!(
                "Couldn't create replay folder '{}': {}",
                replay_folder.display(),
                e
            );
            return INVALID_HANDLE_VALUE;
        }
    }

    let entries = match std::fs::read_dir(&replay_folder) {
        Ok(o) => o,
        Err(e) => {
            error!(
                "Couldn't read replay folder '{}': {}",
                replay_folder.display(),
                e
            );
            return INVALID_HANDLE_VALUE;
        }
    };
    let mut count = 0;
    for entry in entries {
        let entry = match entry {
            Ok(o) => o,
            Err(e) => {
                error!(
                    "Couldn't read replay folder '{}': {}",
                    replay_folder.display(),
                    e
                );
                return INVALID_HANDLE_VALUE;
            }
        };
        let path = entry.path();
        if path.extension() == Some(OsStr::new("rep")) {
            if let Some(file_stem) = path.file_stem() {
                count = count.max(initial_number(file_stem));
            }
        }
    }
    let filename = format!(
        "{:04}_{}.rep",
        count + 1,
        chrono::Local::now().format("%Y-%m-%d")
    );
    CreateFileW(
        windows::winapi_str(replay_folder.join(filename)).as_ptr(),
        access,
        share_mode,
        security_attributes as *mut _,
        creation_disposition,
        flags,
        template,
    )
}

fn initial_number(path: &OsStr) -> u32 {
    use std::os::windows::ffi::OsStrExt;
    // Trickery to parse the initial number without assuming UTF-8 filename..
    path.encode_wide()
        .take_while(|&x| x >= b'0' as u16 && x <= b'9' as u16)
        .fold(0, |old, new| {
            old.wrapping_mul(10)
                .wrapping_add((new - b'0' as u16) as u32)
        })
}

#[test]
fn test_initial_number() {
    assert_eq!(initial_number(OsStr::new("123asdhk")), 123);
    assert_eq!(initial_number(OsStr::new("asd")), 0);
    assert_eq!(initial_number(OsStr::new("a234sd")), 0);
    assert_eq!(initial_number(OsStr::new("1")), 1);
    assert_eq!(initial_number(OsStr::new("001241.rep")), 1241);
    assert_ne!(
        initial_number(OsStr::new("100000000000000000001241.rep")),
        0
    );
}

fn get_documents_path() -> Result<PathBuf, io::Error> {
    use winapi::um::combaseapi::CoTaskMemFree;
    use winapi::um::knownfolders::FOLDERID_Documents;
    use winapi::um::shlobj::SHGetKnownFolderPath;

    unsafe {
        let mut path = null_mut();
        let error = SHGetKnownFolderPath(&FOLDERID_Documents, 0, null_mut(), &mut path);
        if error != 0 {
            return Err(io::Error::from_raw_os_error(error));
        }
        let len = (0..).find(|&x| *path.add(x) == 0).unwrap();
        let slice = std::slice::from_raw_parts(path, len);
        let result = windows::os_string_from_winapi(slice);
        CoTaskMemFree(path as *mut _);
        Ok(result.into())
    }
}

unsafe fn create_lobby(
    map_path: &Path,
    name: &str,
    game_type: bw::GameType,
) -> Result<(), bw::LobbyCreateError> {
    let map = find_map_entry(map_path)?;
    // Password must be null for replays to work
    let name = windows::ansi_codepage_cstring(name)
        .unwrap_or_else(|_| (&b"Shieldbattery\0"[..]).into());
    let password = null_mut();
    let map_folder_path = (*vars::current_map_folder_path).as_ptr();
    let speed = 6; // Fastest
    let result = select_map_or_directory(
        name.as_ptr(),
        password,
        game_type.as_u32(),
        speed,
        map_folder_path,
        map,
    );
    if result != 0 {
        return Err(bw::LobbyCreateError::from_error_code(result));
    }
    init_game_network();
    Ok(())
}

unsafe fn find_map_entry(map_path: &Path) -> Result<*mut bw::MapListEntry, bw::LobbyCreateError> {
    let map_dir = match map_path.parent() {
        Some(s) => s.into(),
        None => {
            warn!(
                "Assuming map '{}' is in current working directory",
                map_path.display()
            );
            match std::env::current_dir() {
                Ok(o) => o,
                Err(_) => return Err(bw::LobbyCreateError::MapNotFound),
            }
        }
    };
    let map_file = match map_path.file_name() {
        Some(s) => s,
        None => return Err(bw::LobbyCreateError::MapNotFound),
    };
    let map_file = windows::ansi_codepage_cstring(&map_file)
        .map_err(|_| bw::LobbyCreateError::NonAnsiPath(map_file.into()))?;
    let map_dir = windows::ansi_codepage_cstring(&map_dir)
        .map_err(|_| bw::LobbyCreateError::NonAnsiPath(map_dir.into()))?;
    for (i, &val) in map_dir.iter().enumerate() {
        vars::current_map_folder_path[i] = val;
    }

    extern "stdcall" fn dummy(_a: *mut bw::MapListEntry, _b: *const u8, _c: u32) -> u32 {
        0
    }
    get_maps_list(
        0x28,
        (*vars::current_map_folder_path).as_ptr(),
        "\0".as_ptr(),
        dummy,
    );
    let mut current_map = *vars::map_list_root;
    while current_map as isize > 0 {
        let name = CStr::from_ptr((*current_map).name.as_ptr() as *const i8);
        if name.to_bytes_with_nul() == &map_file[..] {
            return Ok(current_map);
        }
        current_map = (*current_map).next;
    }
    Err(bw::LobbyCreateError::MapNotFound)
}

pub unsafe fn chat_command_hook(text: *const u8, orig: unsafe extern fn(*const u8)) {
    if *vars::chat_message_type == bw::CHAT_MESSAGE_ALLIES {
        if let Some(player_override) = chat::get_ally_override() {
            *vars::chat_message_recipients = player_override;
        }
    }
    orig(text);
}

unsafe fn entry_point_hook(
    a1: *mut c_void,
    a2: *mut c_void,
    a3: *const u8,
    a4: i32,
    orig: unsafe extern fn(*mut c_void, *mut c_void, *const u8, i32) -> i32,
) -> i32 {
    if crate::WAIT_DEBUGGER {
        let start = std::time::Instant::now();
        while winapi::um::debugapi::IsDebuggerPresent() == 0 {
            std::thread::sleep(std::time::Duration::from_millis(10));
            if start.elapsed().as_secs() > 100 {
                std::process::exit(0);
            }
        }
    }
    // In addition to just setting up a connection to the client,
    // initialize will also get the game settings and wait for startup command from the
    // Shieldbattery client. As such, relatively lot will happen before we let BW execute even a
    // single line of its original code.
    crate::initialize();
    orig(a1, a2, a3, a4)
}
