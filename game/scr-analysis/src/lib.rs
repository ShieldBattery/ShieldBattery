//! This is a crate that just instantiates samase_scarf analysis explicitly to x86
//! implementation. (Not that the x64 even works yet)
//! Having it be a separate from rest of the game helps with compile times, as the main
//! crate can just link directly with this when not optimizing for release, and is also
//! required for the main crate to build this as optimized for faster SC:R launching with
//! otherwise unoptimized builds.
//!
//! All the code in this crate is pretty much uninteresting boilerplate that declares
//! whatever the main crate's BwScr::new wants.
//!
//! IMPORTANT: this crate intentionally wraps only the subset of samase_scarf's `Analysis`
//! surface that the main crate actually uses. An analysis "missing" here is often already
//! implemented in samase_scarf — check the pinned samase_scarf rev's `Analysis` API before
//! concluding new binary analysis is needed; if it exists there, adding a one-line wrapper
//! method in this file is the whole job.

pub use samase_scarf::scarf;
pub use samase_scarf::{DatTablePtr, DatType};

use scarf::exec_state::ExecutionState as _;
use scarf::exec_state::VirtualAddress as _;
use scarf::{BinaryFile, MemAccessSize, Operand, OperandCtx};

#[cfg(target_arch = "x86")]
use scarf::ExecutionStateX86 as ExecutionState;

#[cfg(target_arch = "x86_64")]
use scarf::ExecutionStateX86_64 as ExecutionState;

#[cfg(target_arch = "x86")]
pub use scarf::VirtualAddress;

#[cfg(target_arch = "x86_64")]
pub use scarf::VirtualAddress64 as VirtualAddress;

pub type Patch = samase_scarf::Patch<VirtualAddress>;

pub struct Analysis<'e>(
    samase_scarf::Analysis<'e, ExecutionState<'e>>,
    &'e BinaryFile<VirtualAddress>,
    OperandCtx<'e>,
);

impl<'e> Analysis<'e> {
    pub fn new(binary: &'e BinaryFile<VirtualAddress>, ctx: OperandCtx<'e>) -> Analysis<'e> {
        Analysis(samase_scarf::Analysis::new(binary, ctx), binary, ctx)
    }

    fn eud(&mut self, address: u32) -> Option<Operand<'e>> {
        let euds = self.0.eud_table();
        let index = euds
            .euds
            .binary_search_by_key(&address, |x| x.address)
            .ok()?;
        Some(euds.euds.get(index)?.operand)
    }

    fn mem_word(&self, op: Operand<'e>) -> Operand<'e> {
        self.2.mem_any(ExecutionState::WORD_SIZE, op, 0)
    }

    pub fn game(&mut self) -> Option<Operand<'e>> {
        self.0.game()
    }

    pub fn players(&mut self) -> Option<Operand<'e>> {
        self.0.players()
    }

    pub fn rng_seed(&mut self) -> Option<Operand<'e>> {
        self.0.rng_seed()
    }

    pub fn chk_init_players(&mut self) -> Option<Operand<'e>> {
        self.0.chk_init_players()
    }

    pub fn original_chk_player_types(&mut self) -> Option<Operand<'e>> {
        self.0.original_chk_player_types()
    }

    pub fn storm_players(&mut self) -> Option<Operand<'e>> {
        self.0.net_players()
    }

    pub fn init_net_player(&mut self) -> Option<VirtualAddress> {
        self.0.init_net_player()
    }

    pub fn net_player_flags(&mut self) -> Option<Operand<'e>> {
        self.0.net_player_flags()
    }

    pub fn step_network(&mut self) -> Option<VirtualAddress> {
        self.0.step_network()
    }

    pub fn lobby_state(&mut self) -> Option<Operand<'e>> {
        self.0.lobby_state()
    }

    pub fn is_multiplayer(&mut self) -> Option<Operand<'e>> {
        self.0.is_multiplayer()
    }

    pub fn in_lobby_or_game(&mut self) -> Option<Operand<'e>> {
        self.0.in_lobby_or_game()
    }

    pub fn storm_create_game(&mut self) -> Option<VirtualAddress> {
        self.0.storm_create_game()
    }

    // Storm session internals for the netcode-v2 native-lobby join replacement.

    pub fn storm_join_game(&mut self) -> Option<VirtualAddress> {
        self.0.storm_join_game()
    }

    pub fn apply_lobby_force_cmd(&mut self) -> Option<VirtualAddress> {
        self.0.apply_lobby_force_cmd()
    }

    pub fn storm_session_player_lookup_or_create(&mut self) -> Option<VirtualAddress> {
        self.0.storm_session_player_lookup_or_create()
    }

    pub fn get_local_storm_session_player(&mut self) -> Option<VirtualAddress> {
        self.0.get_local_storm_session_player()
    }

    /// Registers a slot -> name mapping used by lobby slot-setup name lookups.
    pub fn storm_register_slot_name(&mut self) -> Option<VirtualAddress> {
        self.0.storm_register_slot_name()
    }

    /// Drains Storm's deferred SNET packet queue; a join replacement must call this.
    pub fn snet_drain_deferred_queue(&mut self) -> Option<VirtualAddress> {
        self.0.snet_drain_deferred_queue()
    }

    pub fn find_storm_session_player(&mut self) -> Option<VirtualAddress> {
        self.0.find_storm_session_player()
    }

    /// Single byte global storm session slot; 0xff = not in a session.
    pub fn storm_local_player_slot(&mut self) -> Option<Operand<'e>> {
        self.0.storm_local_player_slot()
    }

    /// The base added to a session slot to form the game-level net player id
    /// (`local_net_player = slot + storm_turn_base`).
    pub fn storm_turn_base(&mut self) -> Option<Operand<'e>> {
        self.0.storm_turn_base()
    }

    pub fn single_player_start(&mut self) -> Option<VirtualAddress> {
        self.0.single_player_start()
    }

    pub fn find_game_type_template(&mut self) -> Option<VirtualAddress> {
        self.0.find_game_type_template()
    }

    pub fn net_player_count(&mut self) -> Option<VirtualAddress> {
        self.0.net_player_count()
    }

    pub fn is_paused(&mut self) -> Option<Operand<'e>> {
        self.0.is_paused()
    }

    pub fn select_map_entry(&mut self) -> Option<VirtualAddress> {
        self.0.select_map_entry()
    }

    pub fn game_state(&mut self) -> Option<Operand<'e>> {
        self.0.scmain_state()
    }

    pub fn mainmenu_entry_hook(&mut self) -> Option<VirtualAddress> {
        self.0.mainmenu_entry_hook()
    }

    pub fn game_loop(&mut self) -> Option<VirtualAddress> {
        self.0.game_loop()
    }

    pub fn init_map_from_path(&mut self) -> Option<VirtualAddress> {
        self.0.init_map_from_path()
    }

    pub fn join_game(&mut self) -> Option<VirtualAddress> {
        self.0.join_game()
    }

    pub fn load_images(&mut self) -> Option<VirtualAddress> {
        self.0.load_images()
    }

    pub fn images_loaded(&mut self) -> Option<Operand<'e>> {
        self.0.images_loaded()
    }

    pub fn init_game_network(&mut self) -> Option<VirtualAddress> {
        self.0.init_game_network()
    }

    pub fn process_lobby_commands(&mut self) -> Option<VirtualAddress> {
        self.0.process_lobby_commands()
    }

    pub fn send_command(&mut self) -> Option<VirtualAddress> {
        self.0.send_command()
    }

    pub fn local_player_id(&mut self) -> Option<Operand<'e>> {
        self.0.local_player_id()
    }

    pub fn local_storm_player_id(&mut self) -> Option<Operand<'e>> {
        self.0.local_storm_player_id()
    }

    pub fn local_unique_player_id(&mut self) -> Option<Operand<'e>> {
        self.0.local_unique_player_id()
    }

    pub fn net_player_to_game(&mut self) -> Option<Operand<'e>> {
        self.0.net_player_to_game()
    }

    pub fn net_player_to_unique(&mut self) -> Option<Operand<'e>> {
        self.0.net_player_to_unique()
    }

    pub fn choose_snp(&mut self) -> Option<VirtualAddress> {
        self.0.choose_snp()
    }

    pub fn local_player_name(&mut self) -> Option<Operand<'e>> {
        self.0.local_player_name()
    }

    pub fn fonts(&mut self) -> Option<Operand<'e>> {
        self.0.fonts()
    }

    pub fn init_storm_networking(&mut self) -> Option<VirtualAddress> {
        self.0.init_storm_networking()
    }

    pub fn load_snp_list(&mut self) -> Option<VirtualAddress> {
        self.0.load_snp_list()
    }

    pub fn font_cache_render_ascii(&mut self) -> Option<VirtualAddress> {
        self.0.font_cache_render_ascii()
    }

    pub fn ttf_malloc(&mut self) -> Option<VirtualAddress> {
        self.0.ttf_malloc()
    }

    pub fn ttf_render_sdf(&mut self) -> Option<VirtualAddress> {
        self.0.ttf_render_sdf()
    }

    pub fn create_game_dialog_vtbl_on_multiplayer_create(&mut self) -> Option<usize> {
        self.0.create_game_dialog_vtbl_on_multiplayer_create()
    }

    pub fn process_commands(&mut self) -> Option<VirtualAddress> {
        self.0.process_commands()
    }

    pub fn process_events(&mut self) -> Option<VirtualAddress> {
        self.0.process_events()
    }

    pub fn command_lengths(&mut self) -> Vec<u32> {
        (*self.0.command_lengths()).clone()
    }

    pub fn snet_send_packets(&mut self) -> Option<VirtualAddress> {
        self.0.snet_send_packets()
    }

    pub fn snet_recv_packets(&mut self) -> Option<VirtualAddress> {
        self.0.snet_recv_packets()
    }

    pub fn step_io(&mut self) -> Option<VirtualAddress> {
        let scheduler_vtable = Some(self.0.vtables_for_class(b".?AVSchedulerService@services"))
            // There is only 1 matching vtable for now, hopefully it won't change
            .filter(|x| x.len() == 1)
            .map(|x| x[0])?;
        self.1
            .read_address(scheduler_vtable + VirtualAddress::SIZE * 3)
            .ok()
    }

    pub fn init_game(&mut self) -> Option<VirtualAddress> {
        self.0.init_game()
    }

    pub fn init_units(&mut self) -> Option<VirtualAddress> {
        self.0.init_units()
    }

    pub fn file_hook(&mut self) -> Option<VirtualAddress> {
        self.0.open_file()
    }

    pub fn get_tls_index(&self) -> Option<*mut u32> {
        let binary = self.1;
        let base = binary.base();
        let pe_start = binary.read_u32(base + 0x3c).ok()?;
        let tls_offset_in_header = match VirtualAddress::SIZE == 4 {
            true => 0xc0,
            false => 0xd0,
        };
        let tls_offset = binary
            .read_u32(base + pe_start + tls_offset_in_header)
            .ok()
            .filter(|&offset| offset != 0)?;
        let tls_address = base + tls_offset;
        let tls_ptr = binary
            .read_address(tls_address + 2 * VirtualAddress::SIZE)
            .ok()?;
        Some(tls_ptr.as_u64() as *mut u32)
    }

    pub fn prism_pixel_shaders(&mut self) -> Option<Vec<VirtualAddress>> {
        // As of this writing, there are 0x2b pixel shaders in SC:R;
        // assume that finding any less is an error.
        Some((*self.0.prism_pixel_shaders()).clone()).filter(|x| x.len() >= 0x2b)
    }

    pub fn prism_renderer_vtable(&mut self) -> Option<VirtualAddress> {
        Some(self.0.vtables_for_class(b".?AVPrismRenderer@@"))
            .filter(|x| x.len() == 1)
            .map(|x| x[0])
    }

    pub fn first_active_unit(&mut self) -> Option<Operand<'e>> {
        self.0.first_active_unit()
    }

    pub fn client_selection(&mut self) -> Option<Operand<'e>> {
        self.0.client_selection()
    }

    pub fn sprites_by_y_tile_start(&mut self) -> Option<Operand<'e>> {
        self.0.sprite_hlines()
    }

    pub fn sprites_by_y_tile_end(&mut self) -> Option<Operand<'e>> {
        self.0.sprite_hlines_end()
    }

    pub fn first_free_sprite(&mut self) -> Option<Operand<'e>> {
        self.0.first_free_sprite()
    }

    pub fn last_free_sprite(&mut self) -> Option<Operand<'e>> {
        self.0.last_free_sprite()
    }

    pub fn first_active_fow_sprite(&mut self) -> Option<Operand<'e>> {
        self.0.first_fow_sprite()
    }

    pub fn last_active_fow_sprite(&mut self) -> Option<Operand<'e>> {
        self.0.last_fow_sprite()
    }

    pub fn first_free_fow_sprite(&mut self) -> Option<Operand<'e>> {
        self.0.first_free_fow_sprite()
    }

    pub fn last_free_fow_sprite(&mut self) -> Option<Operand<'e>> {
        self.0.last_free_fow_sprite()
    }

    pub fn first_free_image(&mut self) -> Option<Operand<'e>> {
        self.eud(0x0057eb68).map(|x| self.mem_word(x))
    }

    pub fn last_free_image(&mut self) -> Option<Operand<'e>> {
        self.eud(0x0057eb70).map(|x| self.mem_word(x))
    }

    pub fn sprite_x(&mut self) -> Option<(Operand<'e>, u32, MemAccessSize)> {
        self.0.sprite_x_position()
    }

    pub fn sprite_y(&mut self) -> Option<(Operand<'e>, u32, MemAccessSize)> {
        self.0.sprite_y_position()
    }

    pub fn replay_minimap_unexplored_fog_patch(&mut self) -> Option<Patch> {
        self.0
            .replay_minimap_unexplored_fog_patch()
            .map(|x| (*x).clone())
    }

    pub fn step_game(&mut self) -> Option<VirtualAddress> {
        self.0.step_objects()
    }

    pub fn step_replay_commands(&mut self) -> Option<VirtualAddress> {
        self.0.step_replay_commands()
    }

    pub fn replay_data(&mut self) -> Option<Operand<'e>> {
        self.0.replay_data()
    }

    pub fn command_user(&mut self) -> Option<Operand<'e>> {
        self.0.command_user()
    }

    pub fn unique_command_user(&mut self) -> Option<Operand<'e>> {
        self.0.unique_command_user()
    }

    pub fn storm_command_user(&mut self) -> Option<Operand<'e>> {
        self.0.storm_command_user()
    }

    pub fn enable_rng(&mut self) -> Option<Operand<'e>> {
        self.0.rng_enable()
    }

    pub fn init_real_time_lighting(&mut self) -> Option<VirtualAddress> {
        self.0.init_real_time_lighting()
    }

    pub fn dat_table(&mut self, dat: DatType) -> Option<DatTablePtr<'e>> {
        self.0.dat(dat)
    }

    pub fn allocator(&mut self) -> Option<Operand<'e>> {
        self.0.allocator()
    }

    pub fn status_screen_funcs(&mut self) -> Option<VirtualAddress> {
        self.0
            .firegraft_addresses()
            .unit_status_funcs
            .first()
            .copied()
    }

    pub fn replay_visions(&mut self) -> Option<Operand<'e>> {
        self.0.replay_visions()
    }

    pub fn local_visions(&mut self) -> Option<Operand<'e>> {
        self.0.local_visions()
    }

    pub fn replay_show_entire_map(&mut self) -> Option<Operand<'e>> {
        self.0.replay_show_entire_map()
    }

    pub fn start_udp_server(&mut self) -> Option<VirtualAddress> {
        self.0.start_udp_server()
    }

    pub fn order_limit(&mut self) -> Option<Operand<'e>> {
        let limits = self.0.limits();
        limits
            .arrays
            .get(5)
            .filter(|x| x.len() == 1)
            .and_then(|x| x.first())
            .filter(|x| x.1 == 0 && x.2 == 0)
            .map(|x| self.2.mem32(x.0, u64::from(VirtualAddress::SIZE)))
    }

    pub fn first_free_order(&mut self) -> Option<Operand<'e>> {
        self.0.first_free_order()
    }

    pub fn last_free_order(&mut self) -> Option<Operand<'e>> {
        self.0.last_free_order()
    }

    pub fn allocated_order_count(&mut self) -> Option<Operand<'e>> {
        self.0.allocated_order_count()
    }

    pub fn replay_bfix(&mut self) -> Option<Operand<'e>> {
        self.0.replay_bfix()
    }

    pub fn replay_gcfg(&mut self) -> Option<Operand<'e>> {
        self.0.replay_gcfg()
    }

    pub fn prepare_issue_order(&mut self) -> Option<VirtualAddress> {
        self.0.prepare_issue_order()
    }

    pub fn replay_header(&mut self) -> Option<Operand<'e>> {
        self.eud(0x006D0F30)
    }

    pub fn create_game_multiplayer(&mut self) -> Option<VirtualAddress> {
        self.0.create_game_multiplayer()
    }

    pub fn anti_troll(&mut self) -> Option<Operand<'e>> {
        self.0.anti_troll()
    }

    pub fn join_param_variant_type_offset(&mut self) -> Option<usize> {
        self.0.join_param_variant_type_offset()
    }

    pub fn game_data(&mut self) -> Option<Operand<'e>> {
        self.0.game_data()
    }

    pub fn spawn_dialog(&mut self) -> Option<VirtualAddress> {
        self.0.spawn_dialog()
    }

    pub fn step_game_logic(&mut self) -> Option<VirtualAddress> {
        self.0.step_game_logic()
    }

    pub fn units(&mut self) -> Option<Operand<'e>> {
        // This function returns pointer to unit array `vector<bw::Unit>`,
        // samase_scarf units analysis returns pointer to the actual array
        // (So the analysis works with older versions which had hardcoded unit limits
        // and as such had just a global array instead of vector),
        // so extract `x` from samase_scarf result `Mem32[x]` and assume that is correct.
        self.0
            .units()
            .and_then(|x| x.if_memory())
            .map(|mem| mem.address_op(self.2))
    }

    pub fn network_ready(&mut self) -> Option<Operand<'e>> {
        self.0.network_ready()
    }

    pub fn net_user_latency(&mut self) -> Option<Operand<'e>> {
        self.0.net_user_latency()
    }

    // --- Netcode v2 turn/command seam (see scr-netcode-replacement-guide.md §5.1). ---
    // These expose the turn-send / turn-receive / latency-pipe surface so the rally-point2
    // QUIC transport can be interposed above Storm. samase_scarf resolves each of these; they
    // were simply not surfaced through this wrapper before.

    /// OUT hook: `send_turn_message` hands us the fully-assembled local turn (keep-alive + sync
    /// already baked in) just before it crosses into Storm. See guide §5.1 (OUT).
    pub fn send_turn_message(&mut self) -> Option<VirtualAddress> {
        self.0.send_turn_message()
    }

    /// IN hook (wrapper level): `receive_storm_turns` fills `player_turns[]` / `player_turns_size[]`
    /// / `net_player_flags[]` and runs the synced player-leave pass. Replacing this wholesale (not
    /// calling orig) is the receive seam. See guide §5.1 (IN).
    pub fn receive_storm_turns(&mut self) -> Option<VirtualAddress> {
        self.0.receive_storm_turns()
    }

    /// The obfuscated inner routine `receive_storm_turns` calls to do the array fill/readiness work.
    /// Exposed for plausibility-checking the resolved wrapper; the seam replaces the wrapper, not
    /// this. See guide §5.1 (IN) / §5.5 (anti-tamper).
    pub fn storm_receive_turns(&mut self) -> Option<VirtualAddress> {
        self.0.storm_receive_turns()
    }

    /// PIPE hook: `get_outstanding_turn_count` returns `sent_seq - executed_seq`. Bypassing Storm
    /// makes it return a degenerate 0 (unbounded flush), so it must be replaced. See guide §5.1
    /// (PIPE).
    pub fn get_outstanding_turn_count(&mut self) -> Option<VirtualAddress> {
        self.0.get_outstanding_turn_count()
    }

    /// The native latency pipe loop. Replacing this outright is the preferred PIPE strategy (avoids
    /// the degenerate-0 trap in `get_outstanding_turn_count`). See guide §5.1 (PIPE) / §5.2.
    pub fn flush_local_turns_to_latency_depth(&mut self) -> Option<VirtualAddress> {
        self.0.flush_local_turns_to_latency_depth()
    }

    /// One turn's flush (keep-alive seed + `send_turn_message` + sync append). Exposed for
    /// plausibility-checking / self-test. See guide §2.
    pub fn flush_outgoing_command_turn(&mut self) -> Option<VirtualAddress> {
        self.0.flush_outgoing_command_turn()
    }

    /// The synced player-leave pass our `receive_storm_turns` replacement must reproduce inside the
    /// `set_rng_enable(1)` window. See guide §5.8.
    pub fn apply_pending_player_leaves(&mut self) -> Option<VirtualAddress> {
        self.0.apply_pending_player_leaves()
    }

    /// Base of the per-slot pending-leave mailbox: an `int32[0xc]` indexed by storm player id
    /// (stride 4 on both 32- and 64-bit). `0` = no pending leave; nonzero = a reason code awaiting
    /// application (`0x40000006` = dropped, other nonzero = left). [`apply_pending_player_leaves`]
    /// drains it (running the leave handler and clearing the slot back to `0`) once per applied
    /// turn inside the synced-RNG window. To drop a peer, write the reason into the slot on a
    /// server-agreed turn — the write must be identical across clients (it mutates game state in the
    /// synced-RNG window, so divergence desyncs). This is the constant array-base address, not a
    /// `Mem32[..]` deref. See guide §5.8.
    pub fn pending_leave_reason(&mut self) -> Option<Operand<'e>> {
        self.0.pending_leave_reason()
    }

    /// Per-slot pointer to each slot's command bytes for the executable turn. We fill this from our
    /// own buffers in the receive seam. See guide §3.
    pub fn player_turns(&mut self) -> Option<Operand<'e>> {
        self.0.player_turns()
    }

    /// Per-slot command byte length, parallel to [`player_turns`](Self::player_turns).
    pub fn player_turns_size(&mut self) -> Option<Operand<'e>> {
        self.0.player_turns_size()
    }

    /// Whether `net_user_latency` + the sync checksum apply. Read by the native latency pipe. See
    /// guide §4.
    pub fn sync_active(&mut self) -> Option<Operand<'e>> {
        self.0.sync_active()
    }

    /// Built-in/proto turn latency (the pipe-depth floor, natively 2). We may override it. See
    /// guide §4 / §5.3.
    pub fn builtin_turn_latency(&mut self) -> Option<Operand<'e>> {
        self.0.builtin_turn_latency()
    }

    /// Global executable-turn index (`step_network` increments once per executed turn; 1 turn =
    /// 1 frame). Used as the consensus coordinate stamped onto in-game turns. See guide §2 / §5.1.
    pub fn game_frame_count(&mut self) -> Option<Operand<'e>> {
        self.0.game_frame_count()
    }

    pub fn net_format_turn_rate(&mut self) -> Option<VirtualAddress> {
        self.0.net_format_turn_rate()
    }

    pub fn update_game_screen_size(&mut self) -> Option<VirtualAddress> {
        self.0.update_game_screen_size()
    }

    pub fn move_screen(&mut self) -> Option<VirtualAddress> {
        self.0.move_screen()
    }

    pub fn map_width_pixels(&mut self) -> Option<Operand<'e>> {
        self.0.map_width_pixels()
    }

    pub fn map_height_pixels(&mut self) -> Option<Operand<'e>> {
        self.0.map_height_pixels()
    }

    pub fn screen_x(&mut self) -> Option<Operand<'e>> {
        self.0.screen_x()
    }

    pub fn screen_y(&mut self) -> Option<Operand<'e>> {
        self.0.screen_y()
    }

    pub fn game_screen_width_bwpx(&mut self) -> Option<Operand<'e>> {
        self.0.game_screen_width_bwpx()
    }

    pub fn game_screen_height_bwpx(&mut self) -> Option<Operand<'e>> {
        self.0.game_screen_height_bwpx()
    }

    pub fn renderer(&mut self) -> Option<Operand<'e>> {
        self.0.renderer()
    }

    pub fn draw_commands(&mut self) -> Option<Operand<'e>> {
        self.0.draw_commands()
    }

    pub fn vertex_buffer(&mut self) -> Option<Operand<'e>> {
        self.0.vertex_buffer()
    }

    pub fn get_render_target(&mut self) -> Option<VirtualAddress> {
        self.0.get_render_target()
    }

    pub fn init_obs_ui(&mut self) -> Option<VirtualAddress> {
        self.0.init_obs_ui()
    }

    pub fn is_replay(&mut self) -> Option<Operand<'e>> {
        self.0.is_replay()
    }

    pub fn get_ui_consoles(&mut self) -> Option<VirtualAddress> {
        self.0.get_ui_consoles()
    }

    pub fn load_consoles(&mut self) -> Option<VirtualAddress> {
        self.0.load_consoles()
    }

    pub fn init_consoles(&mut self) -> Option<VirtualAddress> {
        self.0.init_consoles()
    }

    pub fn draw_graphic_layers(&mut self) -> Option<VirtualAddress> {
        self.0.draw_graphic_layers()
    }

    pub fn render_screen(&mut self) -> Option<VirtualAddress> {
        self.0.render_screen()
    }

    pub fn main_palette(&mut self) -> Option<Operand<'e>> {
        self.0.main_palette()
    }

    pub fn statres_icons(&mut self) -> Option<Operand<'e>> {
        self.0.statres_icons_ddsgrp()
    }

    pub fn cmdicons(&mut self) -> Option<Operand<'e>> {
        self.0.cmdicons_ddsgrp()
    }

    pub fn use_rgb_colors(&mut self) -> Option<Operand<'e>> {
        self.0.use_rgb_colors()
    }

    pub fn rgb_colors(&mut self) -> Option<Operand<'e>> {
        self.0.rgb_colors()
    }

    /// The Shift+Tab minimap player-color cycle value (0 = normal colors, higher values recolor
    /// allies/enemies/self on the minimap and game view).
    pub fn minimap_color_mode(&mut self) -> Option<Operand<'e>> {
        self.0.minimap_color_mode()
    }

    /// The Tab minimap-terrain toggle flag (nonzero = terrain is blanked instead of drawn).
    pub fn minimap_terrain_hidden(&mut self) -> Option<Operand<'e>> {
        self.0.minimap_terrain_hidden()
    }

    /// Draws all unit/sprite dots on the minimap. In color mode 0 with RGB player colors on, the
    /// dots read `rgb_colors[player]` directly; this function draws the local player's units (and
    /// lone sprites) inline and calls [`draw_minimap_player_units`](Self::draw_minimap_player_units)
    /// / [`draw_minimap_main_player_units`](Self::draw_minimap_main_player_units) for the others.
    pub fn draw_minimap_units(&mut self) -> Option<VirtualAddress> {
        self.0.draw_minimap_units()
    }

    /// Draws one high/neutral player's minimap dots (player ids 8..12). Takes the player id as its
    /// first argument; called from [`draw_minimap_units`](Self::draw_minimap_units)'s player loop.
    pub fn draw_minimap_player_units(&mut self) -> Option<VirtualAddress> {
        self.0.draw_minimap_player_units()
    }

    /// Draws one main player's minimap dots (player ids 0..8). Takes the player id as its first
    /// argument; called from [`draw_minimap_units`](Self::draw_minimap_units)'s player loop.
    pub fn draw_minimap_main_player_units(&mut self) -> Option<VirtualAddress> {
        self.0.draw_minimap_main_player_units()
    }

    pub fn decide_cursor_type(&mut self) -> Option<VirtualAddress> {
        self.0.decide_cursor_type()
    }

    pub fn cursor_dimension_patch(&mut self) -> Option<Patch> {
        self.0.cursor_dimension_patch().map(|x| (*x).clone())
    }

    pub fn cursor_scale_factor(&mut self) -> Option<Operand<'e>> {
        self.0.cursor_scale_factor()
    }

    pub fn load_ddsgrp_cursor(&mut self) -> Option<VirtualAddress> {
        self.0.load_ddsgrp_cursor()
    }

    pub fn select_units(&mut self) -> Option<VirtualAddress> {
        self.0.select_units()
    }

    pub fn first_dialog(&mut self) -> Option<Operand<'e>> {
        self.0.first_dialog()
    }

    pub fn graphic_layers(&mut self) -> Option<Operand<'e>> {
        self.0.graphic_layers()
    }

    pub fn first_player_unit(&mut self) -> Option<Operand<'e>> {
        self.0.first_player_unit()
    }

    pub fn game_screen_height_ratio(&mut self) -> Option<Operand<'e>> {
        self.0.game_screen_height_ratio()
    }

    pub fn zoom(&mut self) -> Option<Operand<'e>> {
        self.0.zoom()
    }

    pub fn console_vtables(&mut self) -> Vec<VirtualAddress> {
        let mut out = Vec::with_capacity(2);
        out.extend(self.0.vtables_for_class(b".?AVSDConsole@@"));
        out.extend(self.0.vtables_for_class(b".?AVHDWideConsole@@"));
        out
    }

    pub fn order_harvest_gas(&mut self) -> Option<VirtualAddress> {
        self.0.order_function(0x53)
    }

    pub fn move_unit(&mut self) -> Option<VirtualAddress> {
        self.0.move_unit()
    }

    pub fn pathing(&mut self) -> Option<Operand<'e>> {
        self.0.pathing()
    }

    pub fn lookup_sound_id(&mut self) -> Option<VirtualAddress> {
        self.0.lookup_sound_id()
    }

    pub fn play_sound(&mut self) -> Option<VirtualAddress> {
        self.0.play_sound()
    }

    pub fn print_text(&mut self) -> Option<VirtualAddress> {
        self.0.print_text()
    }

    pub fn snet_local_player_list(&mut self) -> Option<Operand<'e>> {
        self.0.snet_local_player_list()
    }

    pub fn sc_main(&mut self) -> Option<VirtualAddress> {
        self.0.sc_main()
    }

    pub fn save_replay(&mut self) -> Option<VirtualAddress> {
        self.0.save_replay()
    }

    /// Single byte global holding the in-game chat send-scope while the chat box is open: 0 = box
    /// closed, 1 = single-player local, 2 = everyone, 3 = allies, 4 = a specific player,
    /// 5 = observers.
    pub fn chat_box_mode(&mut self) -> Option<Operand<'e>> {
        self.0.chat_box_mode()
    }
}
