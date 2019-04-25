use libc::c_void;
use winapi::shared::guiddef::GUID;
use winapi::shared::windef::{HDC, HWND, SIZE, RECT};
use winapi::um::unknwnbase::IUnknown;
use winapi::um::winnt::HANDLE;
use winapi::um::wingdi::PALETTEENTRY;

const DD_OK: i32 = 0;
const DDERR_UNSUPPORTED: i32 = winapi::shared::winerror::E_NOTIMPL;
const DDLOCK_WAIT: u32 = 0x1;
const DDERR_ALREADYINITIALIZED: i32 = 0x8876_0005u32 as i32; // I hope this is right..
const DDSD_CAPS: u32 = 0x1;
const DDSD_HEIGHT: u32 = 0x2;
const DDSD_WIDTH: u32 = 0x4;
const DDSD_PITCH: u32 = 0x8;
const DDSD_LPSURFACE: u32 = 0x800;
const DDSCAPS_PRIMARYSURFACE: u32 = 0x200;
const DDPCAPS_8BIT: u32 = 0x4;
const DDPCAPS_ALLOW256: u32 = 0x40;

pub struct IDirectDrawClipper;
#[allow(bad_style)]
#[repr(C, packed)] // I don't actually get why this needs to be packed but fine
#[derive(Copy, Clone)]
// This actually has a lot of unions, but we're not needing them. Size 0x7c
pub struct DDSURFACEDESC2 {
    dwSize: u32,
    dwFlags: u32,
    dwHeight: u32,
    dwWidth: u32,
    lPitch: u32,
    dwBackBufferCount: u32,
    dwMipMapCount: u32,
    dwAlphaBitDepth: u32,
    dwReserved: u32,
    lpSurface: *mut c_void,
    ddckCKDestOverlay: u64,
    ddckCKDestBlt: u64,
    ddckCKSrcOverlay: u64,
    ddckCKSrcBlt: u64,
    ddpfPixelFormat: DDPIXELFORMAT,
    ddsCaps: DDSCAPS2,
    dwTextureStage: u32,
}

#[allow(bad_style)]
#[repr(C)]
#[derive(Copy, Clone)]
// Size 0x20
pub struct DDPIXELFORMAT {
    dwSize: u32,
    dwFlags: u32,
    dwGourCC: u32,
    unions: [u32; 5],
}

#[allow(bad_style)]
#[repr(C)]
#[derive(Copy, Clone)]
pub struct DDSCAPS2 {
    dwCaps: u32,
    dwCaps2: u32,
    dwCaps3: u32,
    dwCaps4: u32,
}

#[allow(bad_style)]
pub struct DDDEVICEIDENTIFIER2;
#[allow(bad_style)]
pub struct DDCAPS;

pub type LPDDENUMMODESCALLBACK2 = Option<unsafe extern "system" fn(
    *const DDSURFACEDESC2, *mut c_void
) -> i32>;
pub type LPDDENUMSURFACESCALLBACK7 = Option<unsafe extern "system" fn(
    *mut IDirectDrawSurface7, *const DDSURFACEDESC2, *mut c_void
) -> i32>;

fn ddraw_log() -> bool {
    // Should probably just make the logger filter this is not wanted
    false
}

// A somewhat ridiculous macro to make implementing mostly-empty DirectDraw interfaces
// less painful.
//
// NOTE: This macro declares a repr(C) struct for the vtable as the winapi crate lacks
// directdraw types >:(
// This means that macro invocations must include all of the functions the interface requires
// and in correct order.
macro_rules! impl_ddraw {
    (
        method, [unimpl],
            $iface_name:ident, $indirect_draw_name:ident, $name:ident,
            [$($arg_name:ident, $arg_type:ty,)*], $block:block
    ) => {
        #[allow(bad_style)]
        pub unsafe extern "system" fn $name(_this: *mut $iface_name, $($arg_name: $arg_type),*) -> i32 {
            if ddraw_log() {
                $block
            }
            DDERR_UNSUPPORTED
        }
    };

    (
        method, [],
            $iface_name:ident, $indirect_draw_name:ident, $name:ident,
            [$first_arg:ident, $first_arg_ty:ty, $($arg_name:ident, $arg_type:ty,)*], $block:block
    ) => {
        #[allow(bad_style)]
        pub unsafe extern "system" fn $name(this: *mut $iface_name, $($arg_name: $arg_type),*) -> i32 {
            let $first_arg: $first_arg_ty = this as *mut $indirect_draw_name;
            $block
        }
    };

    (method_type, [unimpl], $iface_name:ident, [$($arg_type:ty,)*]) => {
        unsafe extern "system" fn( *mut $iface_name, $($arg_type,)* ) -> i32
    };

    (method_type, [], $iface_name:ident, [$first_arg:ty, $($arg_type:ty,)*]) => {
        unsafe extern "system" fn( *mut $iface_name, $($arg_type,)* ) -> i32
    };

    (
        [
            $vtable_struct:ident,
            $vtable_global:ident,
            $iface_name:ident,
            $indirect_draw_name:ident,
            $module_name:ident
        ]
        $(
            $(~$unimpl:tt)? $name:ident($($arg_name:ident : $arg_type:ty),*) $block:block
        )*
    ) => {
        #[repr(C)]
        pub struct $iface_name {
            vtable: *const $vtable_struct,
        }

        #[allow(bad_style)]
        #[repr(C)]
        struct $vtable_struct {
            $(
                $name: impl_ddraw!(method_type, [$($unimpl)*], $iface_name, [$($arg_type,)*]),
            )*
        }
        static $vtable_global: $vtable_struct = $vtable_struct {
            $(
                $name: $module_name::$name,
            )*
        };

        mod $module_name {
            use super::*;
            $(
                impl_ddraw!(
                    method, [$($unimpl)*],
                    $iface_name, $indirect_draw_name, $name,
                    [$($arg_name, $arg_type,)*], $block
                );
            )*
        }
    };
}

impl_ddraw! {
    [IDirectDraw7VTable, INDIRECT_DRAW_VTABLE, IDirectDraw7, IndirectDraw, ddraw]
    // BW should never actually use this to deal with creation, so just not going to implement this
    ~unimpl QueryInterface(_guid: *const GUID, _out: *mut *mut c_void) {
        debug!("IndirectDraw::QueryInterface");
    }
    AddRef(this: *mut IndirectDraw) {
        (*this).refcount += 1;
        let refcount = (*this).refcount;
        if ddraw_log() {
            debug!("IndirectDraw::AddRef, new refcount {}", refcount);
        }
        refcount
    }
    Release(this: *mut IndirectDraw) {
        (*this).refcount -= 1;
        let refcount = (*this).refcount;
        if ddraw_log() {
            debug!("IndirectDraw::Release, new refcount {}", refcount);
        }
        if refcount <= 0 {
            Box::from_raw(this);
        }
        refcount
    }
    ~unimpl Compact() {
        debug!("Compact");
    }
    ~unimpl CreateClipper(flags: u32, _out: *mut *mut IDirectDrawClipper, _unused: *mut IUnknown) {
        debug!("CreateClipper, flags {:x}", flags);
    }
    CreatePalette(
        this: *mut IndirectDraw,
        flags: u32,
        color_array: *const PALETTEENTRY,
        out: *mut *mut IDirectDrawPalette,
        _unused: *mut IUnknown
    ) {
        if ddraw_log() {
            debug!("CreatePalette, flags {:x}", flags);
        }
        let palette = IndirectDrawPalette::new(this, flags, color_array);
        *out = palette as *mut IDirectDrawPalette;
        (*this).palette_changed = true;
        DD_OK
    }
    CreateSurface(
        this: *mut IndirectDraw,
        desc: *const DDSURFACEDESC2,
        out: *mut *mut IDirectDrawSurface7,
        _unused: *mut IUnknown
    ) {
        if ddraw_log() {
            debug!(
                "CreateSurface, flags: {:x}, height: {}, width: {}, pitch {}, \
                backBufferCount: {}, caps1: {:x}, caps2: {:x}",
                (*desc).dwFlags, (*desc).dwHeight, (*desc).dwWidth, (*desc).lPitch,
                (*desc).dwBackBufferCount, (*desc).ddsCaps.dwCaps, (*desc).ddsCaps.dwCaps2,
            );
        }
        let surface = IndirectDrawSurface::new(this, desc);
        *out = surface as *mut IDirectDrawSurface7;
        if is_primary_surface(surface) {
            // To avoid a ref loop, we *don't* add a ref here, but we do when the surface is
            // marked dirty (and we plan to access it)
            (*this).primary_surface = Some(surface);
        }
        DD_OK
    }
    ~unimpl DuplicateSurface(_surface: *mut IDirectDrawSurface7, _out: *mut *mut IDirectDrawSurface7) {
        debug!("DuplicateSurface");
    }
    ~unimpl EnumDisplayModes(
        flags: u32,
        _desc: *const DDSURFACEDESC2,
        _param: *mut c_void,
        _callback: LPDDENUMMODESCALLBACK2
    ) {
        debug!("EnumDisplayModes, flags {:x}", flags);
    }
    ~unimpl EnumSurfaces(
        flags: u32,
        _desc: *const DDSURFACEDESC2,
        _param: *mut c_void,
        _callback: LPDDENUMSURFACESCALLBACK7
    ) {
        debug!("EnumSurfaces, flags {:x}", flags);
    }
    ~unimpl FlipToGDISurface() {
        debug!("FlipToGDISurface");
    }
    ~unimpl GetCaps(_driver_caps: *mut DDCAPS, _hel_caps: *mut DDCAPS) {
        debug!("GetCaps");
    }
    ~unimpl GetDisplayMode(_desc: *const DDSURFACEDESC2) {
        debug!("GetDisplayMode");
    }
    ~unimpl GetFourCCCodes(_num: *mut u32, _codes: *mut u32) {
        debug!("GetFourCCCodes");
    }
    ~unimpl GetGDISurface(_out: *mut *mut IDirectDrawSurface7) {
        debug!("GetGDISurface");
    }
    ~unimpl GetMonitorFrequency(_freq: *mut u32) {
        debug!("GetMonitorFrequency");
    }
    ~unimpl GetScanLine(_scanline: *mut u32) {
        debug!("GetScanLine");
    }
    ~unimpl GetVerticalBlankStatus(_is_in_vblank: *mut u32) {
        debug!("GetVerticalBlankStatus");
    }
    ~unimpl Initialize(_guid: *const GUID) {
        debug!("Initialize");
    }
    ~unimpl RestoreDisplayMode() {
        debug!("RestoreDisplayMode");
    }
    SetCooperativeLevel(this: *mut IndirectDraw, window: HWND, flags: u32) {
        if ddraw_log() {
            debug!("SetCooperativeLevel, flags {:x}", flags);
        }
        (*this).window = Some(window);
        maybe_initialize_renderer(this);
        DD_OK
    }
    SetDisplayMode(
        this: *mut IndirectDraw,
        width: u32,
        height: u32,
        bpp: u32,
        refresh_rate: u32,
        flags: u32
    ) {
        if ddraw_log() {
            debug!(
                "SetDisplayMode ({},{}), bpp {}, refresh rate {}, flags {:x}",
                width, height, bpp, refresh_rate, flags,
            );
        }
        (*this).display_width = width;
        (*this).display_height = height;
        (*this).display_bpp = bpp;
        maybe_initialize_renderer(this);
        DD_OK
    }
    ~unimpl WaitForVerticalBlank(flags: u32, _handle: HANDLE) {
        debug!("WaitForVerticalBlank, flags {:x}", flags);
    }
    ~unimpl GetAvailableVidMem(_caps: *const DDSCAPS2, _total: *mut u32, _free: *mut u32) {
        debug!("GetAvailableVidMem");
    }
    ~unimpl GetSurfaceFromDC(_dc: HDC, _surface: *mut *mut IDirectDrawSurface7) {
        debug!("GetSurfaceFromDC");
    }
    ~unimpl RestoreAllSurfaces() {
        debug!("RestoreAllSurfaces");
    }
    ~unimpl TestCooperativeLevel() {
        debug!("TestCooperativeLevel");
    }
    ~unimpl GetDeviceIdentifier(_id: *mut DDDEVICEIDENTIFIER2, flags: u32) {
        debug!("GetDeviceIdentifier, flags {:x}", flags);
    }
    ~unimpl StartModeTest(_modes: *const SIZE, num: u32, flags: u32) {
        debug!("StartModeTest, num {}, flags {:x}", num, flags);
    }
    ~unimpl EvaluateMode(flags: u32, _timeout: *mut u32) {
        debug!("EvaluateMode, flags {:x}", flags);
    }
}

pub unsafe extern "system" fn direct_draw_create(
    _guid: *const GUID,
    out: *mut *mut IDirectDraw7,
    _unused: *mut IUnknown,
) -> i32 {
    debug!("DirectDrawCreate");
    let ddraw = Box::into_raw(Box::new(IndirectDraw {
        vtable: &INDIRECT_DRAW_VTABLE,
        refcount: 1,
        window: None,
        display_width: 0,
        display_height: 0,
        display_bpp: 0,
        primary_surface: None,
        palette_changed: false,
        dirty: false,
    }));
    *out = ddraw as *mut IDirectDraw7;
    DD_OK
}

#[repr(C)]
pub struct IndirectDraw {
    vtable: *const IDirectDraw7VTable,
    refcount: i32,
    window: Option<HWND>,
    display_width: u32,
    display_height: u32,
    display_bpp: u32,
    primary_surface: Option<*mut IndirectDrawSurface>,
    palette_changed: bool,
    dirty: bool,
}

impl IndirectDraw {
    pub unsafe fn new_palette(&mut self) -> Option<Vec<PALETTEENTRY>> {
        if !self.palette_changed {
            return None;
        }
        if let Some(surface) = self.primary_surface {
            if let Some(palette) = (*surface).palette {
                self.palette_changed = false;
                return Some((*palette).entries.clone());
            }
        }
        None
    }

    pub unsafe fn new_frame(&mut self) -> Option<Vec<u8>> {
        if !self.dirty {
            return None;
        }
        if let Some(surface) = self.primary_surface {
            ((*(*surface).vtable).Release)(surface as *mut IDirectDrawSurface7);
            self.dirty = false;
            return Some((*surface).surface_data.clone());
        }
        None
    }
}

impl Drop for IndirectDraw {
    fn drop(&mut self) {
        unsafe {
            if let Some(surface) = self.primary_surface {
                if self.dirty {
                    ((*(*surface).vtable).Release)(surface as *mut IDirectDrawSurface7);
                }
            }
        }
    }
}

unsafe fn mark_ddraw_dirty(this: *mut IndirectDraw) {
    if !(*this).dirty {
        (*this).dirty = true;
        let primary_surface = (*this).primary_surface
            .expect("Marked dirty without primary surface");
        ((*(*primary_surface).vtable).AddRef)(primary_surface as *mut IDirectDrawSurface7);
    }
}

unsafe fn maybe_initialize_renderer(this: *mut IndirectDraw) {
    if let Some(window) = (*this).window {
        if (*this).display_width != 0 {
            debug!("IndirectDraw ready to initialize renderer");
            super::with_forge(|forge| {
                forge.renderer.initialize(
                    this,
                    window,
                    &forge.settings,
                    (*this).display_width,
                    (*this).display_height,
                );
            });
        }
    }
}

impl_ddraw! {
    [IDirectDrawSurface7Vtable, INDIRECT_DRAW_SURFACE_VTABLE, IDirectDrawSurface7, IndirectDrawSurface, surface]
    // BW should never actually use this to deal with creation, so just not going to implement this
    ~unimpl QueryInterface(_guid: *const GUID, _out: *mut *mut c_void) {
        debug!("IndirectDrawSurface::QueryInterface");
    }
    AddRef(this: *mut IndirectDrawSurface) {
        (*this).refcount += 1;
        let refcount = (*this).refcount;
        if ddraw_log() {
            debug!("IndirectDrawSurface::AddRef, new refcount {}", refcount);
        }
        refcount
    }
    Release(this: *mut IndirectDrawSurface) {
        (*this).refcount -= 1;
        let refcount = (*this).refcount;
        if ddraw_log() {
            debug!("IndirectDrawSurface::Release, new refcount {}", refcount);
        }
        if refcount <= 0 {
            Box::from_raw(this);
        }
        refcount
    }
    ~unimpl AddAttachedSurface(_surface: *mut IDirectDrawSurface7) {
        debug!("AddAttachedSurface");
    }
    ~unimpl AddOverlayDirtyRect(_rect: *const RECT) {
        debug!("AddOverlayDirtyRect");
    }
    ~unimpl Blt(
        _dest_rect: *const RECT,
        _src: *mut IDirectDrawSurface7,
        _src_rect: *const RECT,
        flags: u32,
        _fx: *mut c_void
    ) {
        debug!("Blt, flags {:x}", flags);
    }
    ~unimpl BltBatch(_ops: *mut c_void, count: u32, _unused: u32) {
        debug!("BltBatch, operation count {}", count);
    }
    ~unimpl BltFast(x: u32, y: u32, _src: *mut IDirectDrawSurface7, _src_rect: *const RECT, flags: u32) {
        debug!("BltFast, to {}, {}, flags {:x}", x, y, flags);
    }
    ~unimpl DeleteAttachedSurface(flags: u32, _attacher: *mut IDirectDrawSurface7) {
        debug!("DeleteAttachedSurface, flags {:x}", flags);
    }
    ~unimpl EnumAttachedSurfaces(_ctx: *mut c_void, _callback: *mut c_void) {
        debug!("EnumAttachedSurfaces");
    }
    ~unimpl EnumOverlayZOrders(flags: u32, _ctx: *mut c_void, _callback: *mut c_void) {
        debug!("EnumOverlayZOrders, flags {:x}", flags);
    }
    ~unimpl Flip(_target_override: *mut IDirectDrawSurface7, flags: u32) {
        debug!("Flip, flags {:x}", flags);
    }
    ~unimpl GetAttachedSurface(_caps: *mut DDSCAPS2, _out: *mut *mut IDirectDrawSurface7) {
        debug!("GetAttachedSurface");
    }
    ~unimpl GetBltStatus(flags: u32) {
        debug!("GetBltStatus, flags {:x}", flags);
    }
    ~unimpl GetCaps(_out: *mut DDSCAPS2) {
        debug!("GetCaps");
    }
    ~unimpl GetClipper(_out: *mut *mut IDirectDrawClipper) {
        debug!("GetClipper");
    }
    ~unimpl GetColorKey(flags: u32, _out: *mut c_void) {
        debug!("GetColorKey, flags {:x}", flags);
    }
    ~unimpl GetDC(_out: *mut HDC) {
        debug!("GetDC");
    }
    ~unimpl GetFlipStatus(flags: u32) {
        debug!("GetFlipStatus, flags {:x}", flags);
    }
    ~unimpl GetOverlayPosition(_x_out: *mut u32, _y_out: *mut u32) {
        debug!("GetOverlayPosition");
    }
    ~unimpl GetPalette(_out: *mut *mut IDirectDrawPalette) {
        debug!("GetPalette");
    }
    ~unimpl GetPixelFormat(_out: *mut DDPIXELFORMAT) {
        debug!("GetPixelFormat");
    }
    ~unimpl GetSurfaceDesc(_out: *mut DDSURFACEDESC2) {
        debug!("GetSurfaceDesc");
    }
    Initialize(_this: *mut IndirectDrawSurface, _ddraw: *mut IDirectDraw7, _desc: *const DDSURFACEDESC2) {
        if ddraw_log() {
            debug!("IndirectDrawSurface::Initialize");
        }
        DDERR_ALREADYINITIALIZED  // this is how this is meant to work, apparently.
    }
    ~unimpl IsLost() {
        debug!("IsLost");
    }
    Lock(
        this: *mut IndirectDrawSurface,
        _dest_rect: *const RECT,
        surface_desc: *mut DDSURFACEDESC2,
        flags: u32,
        _unused: HANDLE
    ) {
        if ddraw_log() {
            debug!("IndirectDrawSurface::Lock");
        }
        // Ensure our assumptions are correct across all lock calls, if this ever fails,
        // please fix or file a bug :)
        assert_eq!(flags, DDLOCK_WAIT);
        assert_eq!((*surface_desc).dwSize, (*this).surface_desc.dwSize);
        std::ptr::copy_nonoverlapping(
            &(*this).surface_desc as *const DDSURFACEDESC2 as *const u8,
            surface_desc as *mut u8,
            (*surface_desc).dwSize as usize,
        );
        (*surface_desc).dwFlags |= DDSD_LPSURFACE | DDSD_WIDTH | DDSD_HEIGHT | DDSD_PITCH;
        (*surface_desc).lpSurface = (*this).surface_data.as_mut_ptr() as *mut c_void;
        // this should maybe actually implement a lock of some sort, but since I'm not sure of
        // the exact behavior of DDraw here, and we aren't actually shuffling memory, and I trust
        // BW to have few lock stomping issues (ha, ha), I'll leave this out for now

        DD_OK
    }
    ~unimpl ReleaseDC(_dc: HDC) {
        debug!("IndirectDrawSurface::ReleaseDC");
    }
    ~unimpl Restore() {
        debug!("Restore");
    }
    ~unimpl SetClipper(_clipper: *mut IDirectDrawClipper) {
        debug!("SetClipper");
    }
    ~unimpl SetColorKey(flags: u32, _color_key: *mut c_void) {
        debug!("SetColorKey, flags {:x}", flags);
    }
    ~unimpl SetOverlayPosition(_x: u32, _y: u32) {
        debug!("SetOverlayPosition");
    }
    SetPalette(this: *mut IndirectDrawSurface, palette: *mut IDirectDrawPalette) {
        if ddraw_log() {
            debug!("IndirectDrawSurface::SetPalette");
        }
        if let Some(palette) = (*this).palette {
            ((*(*palette).vtable).Release)(palette as *mut IDirectDrawPalette);
        }
        ((*(*palette).vtable).AddRef)(palette);
        (*this).palette = Some(palette as *mut IndirectDrawPalette);
        DD_OK
    }
    Unlock(this: *mut IndirectDrawSurface, _locked_rect: *const RECT) {
        if ddraw_log() {
            debug!("IndirectDrawSurface::Unlock");
        }
        if is_primary_surface(this) {
            mark_ddraw_dirty((*this).owner);
        }
        DD_OK
    }
    ~unimpl UpdateOverlay(
        _src_rect: *const RECT,
        _dest_surface: *mut IDirectDrawSurface7,
        _dest_rect: *const RECT,
        flags: u32,
        _overlay_fx: *mut c_void
    ) {
        debug!("UpdateOverlay, flags {:x}", flags);
    }
    ~unimpl UpdateOverlayDisplay(_unused: u32) {
        debug!("UpdateOverlayDisplay");
    }
    ~unimpl UpdateOverlayZOrder(flags: u32, _surface: *mut IDirectDrawSurface7) {
        debug!("UpdateOverlayZOrder, flags {:x}", flags);
    }
    /*** Added in the v2 interface ***/
    ~unimpl GetDDInterface(_ddraw: *mut *mut c_void) {
        debug!("GetDDInterface");
    }
    ~unimpl PageLock(_unused: u32) {
        debug!("PageLock");
    }
    ~unimpl PageUnlock(_unused: u32) {
        debug!("PageUnlock");
    }
    /*** Added in the v3 interface ***/
    ~unimpl SetSurfaceDesc(_desc: *const DDSURFACEDESC2, _unused: u32) {
        debug!("SetSurfaceDesc");
    }
    /*** Added in the v4 interface ***/
    ~unimpl SetPrivateData(_tag: *const GUID, _data: *mut c_void, size: u32, flags: u32) {
        debug!("SetPrivateData, size {}, flags {:x}", size, flags);
    }
    ~unimpl GetPrivateData(_tag: *const GUID, _data: *mut c_void, _size: *mut u32) {
        debug!("GetPrivateData");
    }
    ~unimpl FreePrivateData(_tag: *const GUID) {
        debug!("FreePrivateData");
    }
    ~unimpl GetUniquenessValue(_value: *mut u32) {
        debug!("GetUniquenessValue");
    }
    ~unimpl ChangeUniquenessValue() {
        debug!("ChangeUniquenessValue");
    }
    ~unimpl SetPriority(priority: u32) {
        debug!("SetPriority {}", priority);
    }
    ~unimpl GetPriority(_out: *mut u32) {
        debug!("GetPriority");
    }
    ~unimpl SetLOD(lod: u32) {
        debug!("SetLOD {}", lod);
    }
    ~unimpl GetLOD(_out: *mut u32) {
        debug!("GetLOD");
    }
}

#[repr(C)]
struct IndirectDrawSurface {
    vtable: *const IDirectDrawSurface7Vtable,
    palette: Option<*mut IndirectDrawPalette>,
    owner: *mut IndirectDraw,
    surface_desc: DDSURFACEDESC2,
    surface_data: Vec<u8>,
    refcount: i32,
}

impl Drop for IndirectDrawSurface {
    fn drop(&mut self) {
        unsafe {
            if let Some(palette) = self.palette {
                ((*(*palette).vtable).Release)(palette as *mut IDirectDrawPalette);
            }
            ((*(*self.owner).vtable).Release)(self.owner as *mut IDirectDraw7);
        }
    }
}

impl IndirectDrawSurface {
    unsafe fn new(owner: *mut IndirectDraw, desc: *const DDSURFACEDESC2) -> *mut IndirectDrawSurface {
        ((*(*owner).vtable).AddRef)(owner as *mut IDirectDraw7);
        let mut desc = *desc;
        if desc.dwFlags & DDSD_WIDTH == 0 {
            desc.dwWidth = (*owner).display_width;
        };
        if desc.dwFlags & DDSD_HEIGHT == 0 {
            desc.dwHeight = (*owner).display_height;
        };
        if desc.dwFlags & DDSD_PITCH == 0 {
            desc.lPitch = desc.dwWidth * (*owner).display_bpp / 8;
        };
        desc.dwFlags |= DDSD_WIDTH | DDSD_HEIGHT | DDSD_PITCH;
        if desc.dwFlags & DDSD_CAPS != 0 {
            if desc.ddsCaps.dwCaps & DDSCAPS_PRIMARYSURFACE != 0 {
                if ddraw_log() {
                    debug!("IndirectDraw: primary surface created");
                }
            }
        }
        Box::into_raw(Box::new(IndirectDrawSurface {
            vtable: &INDIRECT_DRAW_SURFACE_VTABLE,
            palette: None,
            owner,
            surface_desc: desc,
            surface_data: vec![0; desc.dwHeight as usize * desc.lPitch as usize],
            refcount: 1,
        }))
    }
}

unsafe fn is_primary_surface(surface: *mut IndirectDrawSurface) -> bool {
    (*surface).surface_desc.ddsCaps.dwCaps & DDSCAPS_PRIMARYSURFACE != 0
}

impl_ddraw! {
    [IDirectDrawPaletteVtable, INDIRECT_DRAW_PALETTE_VTABLE, IDirectDrawPalette, IndirectDrawPalette, palette]
    // BW should never actually use this to deal with creation, so just not going to implement this
    ~unimpl QueryInterface(_guid: *const GUID, _out: *mut *mut c_void) {
        debug!("IndirectDrawPalette::QueryInterface");
    }
    AddRef(this: *mut IndirectDrawPalette) {
        (*this).refcount += 1;
        let refcount = (*this).refcount;
        if ddraw_log() {
            debug!("IndirectDrawPalette::AddRef, new refcount {}", refcount);
        }
        refcount
    }
    Release(this: *mut IndirectDrawPalette) {
        (*this).refcount -= 1;
        let refcount = (*this).refcount;
        if ddraw_log() {
            debug!("IndirectDrawPalette::Release, new refcount {}", refcount);
        }
        if refcount <= 0 {
            Box::from_raw(this);
        }
        refcount
    }
    GetCaps(_this: *mut IndirectDrawPalette, caps: *mut u32) {
        if ddraw_log() {
            debug!("IndirectDrawPalette::GetCaps");
        }
        // we assert in constructor what the caps are, so we can just return those here
        *caps = DDPCAPS_8BIT | DDPCAPS_ALLOW256;
        DD_OK
    }
    GetEntries(this: *mut IndirectDrawPalette, _flags: u32, start: u32, count: u32, out: *mut PALETTEENTRY) {
        if ddraw_log() {
            debug!("IndirectDrawPalette::GetEntries start {}, count {}", start, count);
        }
        assert!(count > 0);
        assert!(start + count <= (*this).entries.len() as u32);
        for i in 0..(count as usize) {
            *out.add(i) = (*this).entries[start as usize + i];
        }
        DD_OK
    }
    Initialize(
        _this: *mut IndirectDrawPalette,
        _ddraw: *mut IDirectDraw7,
        _flags: u32,
        _color_array: *const PALETTEENTRY
    ) {
        if ddraw_log() {
            debug!("IndirectDrawPalette::Initialize");
        }
        DDERR_ALREADYINITIALIZED  // this is how this is meant to work, apparently.
    }
    SetEntries(this: *mut IndirectDrawPalette, _flags: u32, start: u32, count: u32, entries: *mut PALETTEENTRY) {
        if ddraw_log() {
            debug!("IndirectDrawPalette::SetEntries start {}, count {}", start, count);
        }
        assert!(count > 0);
        assert!(start + count <= (*this).entries.len() as u32);
        for i in 0..(count as usize) {
            (*this).entries[start as usize + i] = *entries.add(i);
        }
        (*(*this).owner).palette_changed = true;
        DD_OK
    }
}

#[repr(C)]
struct IndirectDrawPalette {
    vtable: *const IDirectDrawPaletteVtable,
    entries: Vec<PALETTEENTRY>,
    owner: *mut IndirectDraw,
    refcount: i32,
}

impl Drop for IndirectDrawPalette {
    fn drop(&mut self) {
        unsafe {
            ((*(*self.owner).vtable).Release)(self.owner as *mut IDirectDraw7);
        }
    }
}

impl IndirectDrawPalette {
    unsafe fn new(
        owner: *mut IndirectDraw,
        flags: u32,
        colors: *const PALETTEENTRY,
    ) -> *mut IndirectDrawPalette {
        ((*(*owner).vtable).AddRef)(owner as *mut IDirectDraw7);
        // BW calls this initially with DDPCAPS_8BIT (8-bit entries) and DDPCAPS_ALLOW256
        // (allow all 256 entries to be defined). To make things simple, we will only accept
        // those values
        assert_eq!(flags, (DDPCAPS_8BIT | DDPCAPS_ALLOW256));
        let entries = (0..256).map(|i| *colors.add(i)).collect();
        Box::into_raw(Box::new(IndirectDrawPalette {
            vtable: &INDIRECT_DRAW_PALETTE_VTABLE,
            entries,
            owner,
            refcount: 1,
        }))
    }
}

#[test]
fn struct_sizes() {
    use std::mem::size_of;
    assert_eq!(size_of::<DDSURFACEDESC2>(), 0x7c);
    assert_eq!(size_of::<DDPIXELFORMAT>(), 0x20);
    assert_eq!(size_of::<DDSCAPS2>(), 0x10);
}
