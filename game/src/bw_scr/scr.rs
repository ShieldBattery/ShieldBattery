//! SC:R types we use.
//! Somewhat confusingly separate from `crate::bw::scr` which is alias to `bw_dat::structs::scr`.

use libc::c_void;

use crate::bw;
use crate::bw::SnpFunctions;
use crate::bw_scr::{bw_free, bw_malloc};

use super::thiscall::Thiscall;

pub use bw_dat::structs::scr::{DrawCommand, DrawCommands, DrawSubCommand, DrawSubCommands};

#[repr(C)]
pub struct SnpLoadFuncs {
    pub identify: unsafe extern "system" fn(
        u32,            // snp index
        *mut u32,       // id
        *mut *const i8, // name
        *mut *const i8, // description
        *mut *const crate::bw::SnpCapabilities,
    ) -> u32,
    pub bind: unsafe extern "system" fn(u32, *mut *const SnpFunctions) -> u32,
}

#[repr(C)]
pub struct LobbyDialogVtable {
    pub functions: [usize; 0x50],
}

#[repr(C)]
pub struct GameInput {
    pub name: BwString,
    pub password: BwString,
    pub speed: u8,
    pub game_type_subtype: u32,
    pub turn_rate: u32,
    pub game_flag1: u8,
    pub old_limits: u8,
    pub eud: u8,
    pub safety_padding: [u8; 0x21],
}

#[repr(C)]
pub struct MapDirEntry {
    pub key: u32,
    pub unk4: [u8; 0x1c],
    pub filename: BwString,
    pub title: BwString,
    pub description: BwString,
    pub error_message: BwString,
    pub unk90: BwString,
    pub unkac: BwString,
    pub unkc8: BwString,
    pub unk_linked_list: [usize; 0x3],
    pub loaded: u8,
    pub error: u32,
    pub unk104: [u8; 0x8],
    pub flags: u8,
    pub unk10d: u8,
    pub map_width_tiles: u16,
    pub map_height_tiles: u16,
    pub unk112: [u8; 0xd2],
    pub path_directory: BwString,
    pub path_filename: BwString,
}

#[repr(C)]
pub struct BwString {
    /// A pointer to the current memory containing the characters in the string.
    pub pointer: *mut u8,
    /// Current length of the string, not including the null terminator.
    pub length: usize,
    /// Total size of the memory pointed to by [`pointer`], not including the null terminator.
    /// The sign bit of the capacity signifies whether or not the inline buffer is being used
    /// (sign bit set = internal buffer).
    pub capacity: usize,
    /// A buffer that will be used if the string fits within it.
    pub inline_buffer: [u8; 0x10],
}

impl BwString {
    /// Returns the capacity (with the bit signifying internal/external buffer removed).
    pub fn get_capacity(&self) -> usize {
        self.capacity & (usize::MAX >> 1)
    }

    pub fn is_using_inline_buffer(&self) -> bool {
        self.capacity & !(usize::MAX >> 1) != 0
    }

    /// Replaces the entire contents of the string, allocating new memory if necessary.
    pub fn replace_all(&mut self, replace_with: &str) {
        if replace_with.len() > self.get_capacity() {
            // New value doesn't fit, reallocate
            if !self.is_using_inline_buffer() {
                unsafe {
                    bw_free(self.pointer);
                    self.pointer = std::ptr::null_mut();
                }
            }

            // TODO(tec27): Increase this size a bit to avoid reallocations?
            let new_capacity = replace_with.len();
            unsafe {
                self.pointer = bw_malloc(new_capacity + 1);
                self.capacity = new_capacity;
            }
        }

        unsafe {
            let text_slice = std::slice::from_raw_parts_mut(self.pointer, self.get_capacity() + 1);
            text_slice[..replace_with.len()].copy_from_slice(replace_with.as_bytes());
            text_slice[replace_with.len()] = 0;
            self.length = replace_with.len();
        }
    }
}

#[repr(C)]
pub struct BwVector {
    pub data: *mut c_void,
    pub length: usize,
    pub capacity: usize,
}

#[repr(C)]
pub struct FileHandle {
    pub vtable: *const V_FileHandle1,
    pub vtable2: *const V_FileHandle2,
    pub vtable3: *const V_FileHandle3,
    pub metadata: *mut FileMetadata,
    pub peek: *mut FilePeek,
    pub read: *mut FileRead,
    pub file_ok: u32,
    //pub dc18: [u8; 0x10],
    pub close_callback: Function, // 0x1 = pointer, else inline
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct OpenParams {
    pub extension: *const u8,
    pub _unk4: u32,
    pub file_type: u32,
    pub locale: u32,
    pub flags: u32,
    pub casc_buffer_size: u32,
    pub safety_padding: [u32; 4],
}

#[repr(C)]
pub struct FileRead {
    pub vtable: *const V_FileRead,
    pub inner: *mut c_void,
}

#[repr(C)]
pub struct FilePeek {
    pub vtable: *const V_FilePeek,
    pub inner: *mut c_void,
}

#[repr(C)]
pub struct FileMetadata {
    pub vtable: *const V_FileMetadata,
    pub inner: *mut c_void,
}

/// This seems to be a std::function implementation
#[repr(C)]
#[derive(Copy, Clone)]
pub struct Function {
    pub vtable: *const V_Function,
    pub inner: *mut c_void,
}

#[repr(C)]
pub struct V_FileHandle1 {
    pub destroy: Thiscall<unsafe extern "C" fn(*mut FileHandle, u32)>,
    pub read: Thiscall<unsafe extern "C" fn(*mut FileHandle, *mut u8, u32) -> u32>,
    pub skip: Thiscall<unsafe extern "C" fn(*mut FileHandle, u32)>,
    pub safety_padding: [usize; 0x20],
}

#[repr(C)]
pub struct V_FileHandle2 {
    pub unk0: [usize; 1],
    pub peek: Thiscall<unsafe extern "C" fn(*mut c_void, *mut u8, u32) -> u32>,
    pub safety_padding: [usize; 0x20],
}

#[repr(C)]
pub struct V_FileHandle3 {
    pub unk0: [usize; 1],
    pub tell: Thiscall<unsafe extern "C" fn(*mut c_void) -> u32>,
    pub seek: Thiscall<unsafe extern "C" fn(*mut c_void, u32)>,
    pub file_size: Thiscall<unsafe extern "C" fn(*mut c_void) -> u32>,
    pub safety_padding: [usize; 0x20],
}

#[repr(C)]
pub struct V_FileMetadata {
    pub unk0: [usize; 1],
    pub tell: Thiscall<unsafe extern "C" fn(*mut FileMetadata) -> u32>,
    pub seek: Thiscall<unsafe extern "C" fn(*mut FileMetadata, u32)>,
    pub file_size: Thiscall<unsafe extern "C" fn(*mut FileMetadata) -> u32>,
    pub safety_padding: [usize; 0x20],
}

#[repr(C)]
pub struct V_FileRead {
    pub destroy: usize,
    pub read: Thiscall<unsafe extern "C" fn(*mut FileRead, *mut u8, u32) -> u32>,
    pub skip: Thiscall<unsafe extern "C" fn(*mut FileRead, u32)>,
    pub safety_padding: [usize; 0x20],
}

#[repr(C)]
pub struct V_FilePeek {
    pub destroy: usize,
    pub peek: Thiscall<unsafe extern "C" fn(*mut FilePeek, *mut u8, u32) -> u32>,
    pub safety_padding: [usize; 0x20],
}

#[repr(C)]
pub struct V_Function {
    pub destroy_inner: Thiscall<unsafe extern "C" fn(*mut Function, u32)>,
    pub invoke: Thiscall<unsafe extern "C" fn(*mut Function)>,
    pub get_sizes: Thiscall<unsafe extern "C" fn(*mut Function, *mut usize)>,
    pub copy: Thiscall<unsafe extern "C" fn(*mut Function, *mut Function)>,
    pub copy2: Thiscall<unsafe extern "C" fn(*mut Function, *mut Function)>,
    pub safety_padding: [usize; 0x20],
}

#[repr(C)]
pub struct Font {
    pub unk0: *mut c_void,
    pub unk4: usize,
    pub unk8: *mut c_void,
    pub unkc: u32,
    pub unk10: u32,
    pub ttf: *mut TtfSet,
}

#[repr(C)]
pub struct TtfSet {
    pub fonts: [TtfFont; 5],
}

#[repr(C)]
pub struct TtfFont {
    pub unk0: usize,
    pub raw_ttf: *mut u8,
    #[cfg(target_arch = "x86")]
    pub unk8: [u8; 0x70],
    #[cfg(target_arch = "x86_64")]
    pub unk8: [u8; 0x88],
    pub raw_ttf2: *mut u8, // 78 // 98
    pub unk7c: u32,
    pub scale: f32, // 80 // a4
    pub unk_floats: [f32; 3],
    pub unk90: [u32; 3],
    pub unk90_ptr_sized: [usize; 1],
}

#[repr(C)]
pub struct JoinableGameInfo {
    pub params: BwHashTable<BwString, GameInfoValue>,
    #[cfg(target_arch = "x86")]
    pub unk10: [u8; 0x24],
    #[cfg(target_arch = "x86_64")]
    pub unk10: [u8; 0x40],
    pub game_name: BwString,
    pub sockaddr_family: u16,
    // Network endian
    pub port: u16,
    pub ip: [u8; 4],
    pub game_id: u64,
    pub new_game_type: u32,
    pub game_subtype: u32,
    pub unk68: f32,
    pub unk6c: u32,
    pub timestamp: u64,
    pub unk78: u8,
    pub unk79: u8,
    pub unk7a: [u8; 2],
    // SEXP
    pub product_id: u32,
    // 0xe9
    pub game_version: u32,
    // Padding in the case struct grows or there are more fields
    pub safety_padding: [u8; 0x24],
}

// 9411 and older
#[repr(C)]
pub struct GameInfoValueOld {
    pub variant: u32,
    pub data: GameInfoValueUnion,
}

#[repr(C)]
pub struct GameInfoValue {
    pub data: GameInfoValueUnion,
    pub variant: u32,
}

#[repr(C)]
pub union GameInfoValueUnion {
    pub var1: std::mem::ManuallyDrop<BwString>,
    pub var2_3: u64,
    pub var4: f64,
    pub var5: u8,
}

#[repr(C)]
pub struct BwHashTable<K, V> {
    pub bucket_count: usize,
    pub buckets: *mut *mut BwHashTableEntry<K, V>,
    pub size: usize,
    pub resize_factor: f32,
}

#[repr(C)]
pub struct BwHashTableEntry<K, V> {
    pub next: *mut BwHashTableEntry<K, V>,
    pub pair: Pair<K, V>,
}

#[repr(C)]
pub struct Pair<K, V> {
    pub key: K,
    pub value: V,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct StormPlayer {
    pub state: u8,
    pub unk1: u8,
    pub flags: u16,
    pub unk4: u16,
    // Always 5, not useful for us
    pub protocol_version: u16,
    pub name: [u8; 0x60],
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct PrismShaderSet {
    pub count: u32,
    pub shaders: *mut PrismShader,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct PrismShader {
    pub api_type: u8,
    pub shader_type: u8,
    pub unk: [u8; 6],
    pub data: *const u8,
    pub data_len: u32,
}

#[repr(C)]
pub struct Shader {
    pub id: u32,
    pub rest: [u8; 0x74],
}

#[repr(C)]
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
    pub pos_x: usize,
    pub pos_y: usize,
    pub main_image: *mut bw::Image,
    pub first_image: *mut bw::Image,
    pub last_image: *mut bw::Image,
}

#[repr(C)]
pub struct Allocator {
    pub vtable: *mut AllocatorVtable,
}

#[repr(C)]
pub struct AllocatorVtable {
    pub delete: usize,
    pub alloc: Thiscall<unsafe extern "C" fn(*mut Allocator, usize, usize) -> *mut u8>,
    pub fn2: usize,
    pub fn3: usize,
    pub free: Thiscall<unsafe extern "C" fn(*mut Allocator, *mut u8)>,
}

#[repr(C)]
pub struct ReplayBfix {
    pub flags: u32,
}

#[repr(C)]
pub struct ReplayGcfg {
    pub unk0: [u8; 4],
    pub build: u32,
    pub unk8: [u8; 8],
    pub unk10: u8,
}

#[repr(C)]
pub struct AntiTroll {
    pub active: u8,
}

#[repr(C)]
pub struct NetFormatTurnRateResult {
    // TODO(tec27): Not entirely certain what this is, behaves kind of weird during a DTR scan.
    // This first value is a pointer that gets zeroed out if not used.
    pub unk0: [u8; 4],
    pub text: BwString,
}

#[repr(C)]
pub struct Renderer {
    pub vtable: *const V_Renderer,
}

#[repr(C)]
pub struct V_Renderer {
    pub clone: usize,
    pub init_sub: usize,
    pub init: usize,
    pub unk3: usize,
    pub unk4: usize,
    pub swap_buffers: usize,
    pub unk6: usize,
    pub draw: Thiscall<unsafe extern "C" fn(*mut Renderer, *mut DrawCommands, u32, u32) -> u32>,
    pub clear_color: usize,
    pub unk9: usize,
    pub upload_vertices: usize,
    pub unkb: usize,
    /// format, data, data_len, width, height, filtering, wrap_mode
    pub create_texture: Thiscall<
        unsafe extern "C" fn(
            *mut Renderer,
            u32,
            *const u8,
            usize,
            u32,
            u32,
            u32,
            u32,
        ) -> *mut RendererTexture,
    >,
    pub unkd: usize,
    /// texture, x, y, width, height, data, row_length (pixels), format, filtering, wrap_mode
    pub update_texture: Thiscall<
        unsafe extern "C" fn(
            *mut Renderer,
            *mut RendererTexture,
            u32,
            u32,
            u32,
            u32,
            *const u8,
            u32,
            u32,
            u32,
            u32,
        ),
    >,
    pub delete_texture: Thiscall<unsafe extern "C" fn(*mut Renderer, *mut *mut RendererTexture)>,
    pub create_shader: Thiscall<
        unsafe extern "C" fn(
            *mut Renderer,
            *mut Shader,
            *const u8,
            *const u8,
            *const u8,
            *mut c_void,
        ) -> usize,
    >,
}

/// Opaque struct
#[repr(C)]
pub struct RendererTexture {}

// Checked to have correct layout on both 32/64 bit
#[repr(C)]
pub struct VertexBuffer {
    pub buffer_size_u32s: usize,
    pub allocated_size_bytes: usize,
    pub buffer: BwVector,
    pub subbuffers: BwVector,
    pub heap_allocated: u8,
    pub unk_size: usize,
    pub subbuffer_sizes: usize,
    pub unk2c: usize,
    pub index_buf_size_u16s: usize,
    pub index_buffer_allocated_bytes: usize,
    pub index_buffer: BwVector,
    pub index_buf_heap_allocated: u8,
    pub unk_vertex_buffer_data: *mut c_void,
}

#[repr(C)]
pub struct RenderTarget {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub attachments: u32,
    pub unk14: [u32; 2],
    pub backend_target: *mut c_void,
}

/// Used to sort DrawCommands to be drawn in correct order when rendering.
/// One DrawSort must exist for each DrawCommand used.
#[repr(C)]
pub struct DrawSort {
    pub layer: u16,
    // Self index when pushed to vector
    // Probably used to break ties when layer is same
    pub index: u16,
    pub command: *mut DrawCommand,
}

#[repr(C)]
pub struct Texture {
    pub unk: u32,
    pub width: u16,
    pub height: u16,
    pub renderer_texture: *mut RendererTexture,
    pub scale: u16,
}

#[repr(C)]
pub struct DdsGrp {
    pub frame_count: u16,
    pub textures: *mut Texture,
}

#[repr(C)]
pub struct DdsGrpSet {
    // Legacy palette renderer GRP (Same struct as pre-SC:R)
    pub grp: *mut c_void,
    // SD, HD, Carbot (Carbot is not required to be loaded)
    pub dds_grps: [DdsGrp; 0x3],
    pub ui_asset_id: u32,
    pub unk_20: u8,
    pub unk_21: u8,
    pub unk_22: u8,
    pub unk_23: u8,
    pub unk_24: u8,
}

#[repr(C)]
pub struct UiConsole {
    pub vtable: *const V_UiConsole,
}

#[repr(C)]
pub struct V_UiConsole {
    pub delete: usize,
    pub unk1: usize,
    pub unk2: usize,
    pub unk3: usize,
    pub unk4: usize,
    pub unk5: usize,
    pub hit_test: Thiscall<unsafe extern "C" fn(*mut UiConsole, u32, u32) -> u8>,
}

unsafe impl Sync for PrismShader {}
unsafe impl Send for PrismShader {}

pub const PRISM_SHADER_API_SM4: u8 = 0x0;
pub const PRISM_SHADER_API_SM5: u8 = 0x4;
pub const PRISM_SHADER_TYPE_PIXEL: u8 = 0x6;

#[test]
fn struct_sizes() {
    #[cfg(target_arch = "x86")]
    fn size(value: usize, _: usize) -> usize {
        value
    }
    #[cfg(target_arch = "x86_64")]
    fn size(_: usize, value: usize) -> usize {
        value
    }

    use std::mem::size_of;
    assert_eq!(
        size_of::<JoinableGameInfo>(),
        size(0x84 + 0x24, 0xbc + 0x24)
    );
    assert_eq!(size_of::<StormPlayer>(), 0x68);
    assert_eq!(
        size_of::<SnpFunctions>(),
        (0x3c / 4 + 0x10) * size_of::<usize>()
    );
    assert_eq!(size_of::<PrismShaderSet>(), size(0x8, 0x10));
    assert_eq!(size_of::<PrismShader>(), size(0x10, 0x18));
    assert_eq!(size_of::<DrawCommand>(), size(0xa0, 0xd8));
    // Not correct on 64bit but don't think we rely on the size at all.
    assert_eq!(size_of::<Shader>(), 0x78);
    assert_eq!(size_of::<Sprite>(), size(0x28, 0x48));
    assert_eq!(size_of::<V_Renderer>(), 0x44 / 4 * size_of::<usize>());
    assert_eq!(size_of::<VertexBuffer>(), size(0x4c, 0x98));
    assert_eq!(size_of::<RenderTarget>(), size(0x20, 0x28));
    assert_eq!(size_of::<DrawSort>(), size(0x8, 0x10));
    assert_eq!(size_of::<Texture>(), size(0x10, 0x18));
    assert_eq!(size_of::<DdsGrp>(), size(0x8, 0x10));
    assert_eq!(size_of::<DdsGrpSet>(), size(0x28, 0x48));
    assert_eq!(size_of::<Font>(), size(0x18, 0x28));
    assert_eq!(size_of::<TtfFont>(), size(0xa0, 0xc8));
    assert_eq!(
        size_of::<BwHashTableEntry<BwString, GameInfoValueOld>>(),
        size(0x50, 0x60)
    );
}
