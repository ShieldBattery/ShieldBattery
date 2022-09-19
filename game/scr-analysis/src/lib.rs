//! This is a crate that just instantiates samase_scarf analysis explicitly to x86
//! implementation. (Not that the x64 even works yet)
//! Having it be a separate from rest of the game helps with compile times, as the main
//! crate can just link directly with this when not optimizing for release, and is also
//! required for the main crate to build this as optimized for faster SC:R launching with
//! otherwise unoptimized builds.
//!
//! All the code in this crate is pretty much uninteresting boilerplate that declares
//! whatever the main crate's BwScr::new wants.

pub use samase_scarf::scarf;
pub use samase_scarf::{DatTablePtr, DatType};

use scarf::exec_state::VirtualAddress as VirtualAddressTrait;
use scarf::{BinaryFile, ExecutionStateX86, MemAccessSize, Operand, OperandCtx, VirtualAddress};

pub type Patch = samase_scarf::Patch<VirtualAddress>;

pub struct Analysis<'e>(
    samase_scarf::Analysis<'e, ExecutionStateX86<'e>>,
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

    #[cfg(target_arch = "x86")]
    fn mem_word(&self, op: Operand<'e>) -> Operand<'e> {
        self.2.mem32(op, 0)
    }

    pub fn game(&mut self) -> Option<Operand<'e>> {
        self.0.game()
    }

    pub fn players(&mut self) -> Option<Operand<'e>> {
        self.0.players()
    }

    pub fn chk_init_players(&mut self) -> Option<Operand<'e>> {
        self.0.chk_init_players()
    }

    pub fn original_chk_player_types(&mut self) -> Option<Operand<'e>> {
        self.0.original_chk_player_types()
    }

    pub fn storm_players(&mut self) -> Option<Operand<'e>> {
        self.0.net_players().map(|x| x.0)
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
        let base = binary.base;
        let pe_start = binary.read_u32(base + 0x3c).ok()?;
        let tls_offset = binary
            .read_u32(base + pe_start + 0xc0)
            .ok()
            .filter(|&offset| offset != 0)?;
        let tls_address = base + tls_offset;
        let tls_ptr = binary.read_u32(tls_address + 0x8).ok()?;
        Some(tls_ptr as *mut u32)
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
            .get(0)
            .copied()
    }

    pub fn replay_visions(&mut self) -> Option<Operand<'e>> {
        self.0.replay_visions()
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
            .and_then(|x| x.get(0))
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

    pub fn screen_x(&mut self) -> Option<Operand<'e>> {
        self.0.screen_x()
    }

    pub fn screen_y(&mut self) -> Option<Operand<'e>> {
        self.0.screen_y()
    }

    pub fn game_screen_width_bwpx(&mut self) -> Option<Operand<'e>> {
        self.0.game_screen_width_bwpx()
    }
}
