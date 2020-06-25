//! Caches font SDFs that are being used to render most of the text.
//! (SD uses a DDS texture for ASCII in order to look like 1.16.1)
//! On game launch, they are generated for ASCII characters in range 32
//! to 127, for 8 different fonts. The time this takes ends up being
//! considerable enough that caching this ends up being beneficial.
//!
//! The cache file read/write operations are done in the async threads
//! to reduce the cache overhead a bit. (Reading is initiated well before
//! the cache is actually needed)

use std::collections::hash_map;
use std::mem::ManuallyDrop;
use std::sync::Arc;
use std::path::{Path, PathBuf};

use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use tokio::fs;
use tokio::io::{self, AsyncReadExt, AsyncWriteExt, BufReader};
use fxhash::FxHashMap;
use parking_lot::{MappedMutexGuard, Mutex, MutexGuard};

use super::{BwScr, scr, hooks};

// 2M
const MAX_CACHE_SIZE_BYTES: usize = 2 * 1024 * 1024;

pub fn apply_sdf_cache_hooks<'e>(
    scr: &BwScr,
    exe: &mut whack::ModulePatcher<'_>,
    base: usize,
) {
    let font_cache_render_ascii = scr.font_cache_render_ascii;
    let ttf_render_sdf = scr.ttf_render_sdf;
    let ttf_malloc = scr.ttf_malloc;
    let fonts = scr.fonts;

    let cache = scr.sdf_cache.clone();
    let cache2 = cache.clone();
    unsafe {
        let fonts = fonts.resolve();
        let relative = font_cache_render_ascii.0 as usize - base;
        exe.hook_closure_address(hooks::FontCacheRenderAscii, move |this, orig| {
            orig(this);
            // Moving this to process exit instead could be better,
            // now it won't write anything that is cached after initialization.
            // Also now it writes the cache 4 times if starting from empty,
            // as FontCacheRenderAscii is called for 4 different fonts.
            if cache2.lock().is_dirty() {
                let async_handle = crate::async_handle();
                let mut cache_locked = cache2.clone().lock_owned();
                async_handle.spawn(async move {
                    let cache = cache_locked.as_mut().unwrap();
                    if let Err(e) = cache.write_to_disk().await {
                        warn!("Writing SDF cache failed: {}", e);
                    }
                });
            }
        }, relative);
        let relative = ttf_render_sdf.0 as usize - base;
        exe.hook_closure_address(hooks::Ttf_RenderSdf, move |a, b, c, d, e, f, g, h, i, j, orig| {
            render_sdf(&cache, fonts, ttf_malloc, a, b, c, d, e, f, g, h, i, j, orig)
        }, relative);
    }
}

unsafe fn render_sdf(
    cache: &Arc<InitSdfCache>,
    fonts: *mut *mut scr::Font,
    ttf_malloc: unsafe extern fn(usize) -> *mut u8,
    font: *mut scr::TtfFont,
    a2: f32,
    glyph: u32,
    border: u32,
    edge_value: u32,
    stroke_width: f32,
    out_w: *mut u32,
    out_h: *mut u32,
    out_x: *mut u32,
    out_y: *mut u32,
    orig: unsafe extern fn(
        *mut scr::TtfFont,
        f32,
        u32,
        u32,
        u32,
        f32,
        *mut u32,
        *mut u32,
        *mut u32,
        *mut u32,
    ) -> *mut u8,
) -> *mut u8 {
    let mut cache = cache.lock();
    let font_id = match font_id_from_ptr(fonts, font) {
        Some(s) => s,
        None => {
            warn!("Unknown font {:p}", font);
            return std::ptr::null_mut();
        }
    };
    let result = cache.get(font_id, glyph);
    match result {
        SdfCacheResult::Cached(sdf) => {
            *out_w = sdf.width as u32;
            *out_h = sdf.height as u32;
            *out_x = 0;
            *out_y = 0;
            let data = sdf.data;
            let out = ttf_malloc(data.len());
            let out_slice = std::slice::from_raw_parts_mut(out, data.len());
            out_slice.copy_from_slice(data);
            out
        }
        SdfCacheResult::Missing(entry) => {
            let result = orig(
                font, a2, glyph, border, edge_value, stroke_width, out_w, out_h, out_x, out_y,
            );
            if result.is_null() {
                return result;
            }
            let size = Some((*out_w, *out_h))
                .filter(|&(w, h)| w < 0x10000 && h < 0x10000)
                .and_then(|(w, h)| w.checked_mul(h));
            let size = match size {
                Some(s) => s as usize,
                None => {
                    warn!("Invalid glyph size {} x {}", *out_w, *out_h);
                    return result;
                }
            };
            let slice = std::slice::from_raw_parts(result, size);
            entry.insert(*out_w as u16, *out_h as u16, slice);
            result
        }
    }
}

unsafe fn font_id_from_ptr(fonts: *mut *mut scr::Font, ttf: *mut scr::TtfFont) -> Option<FontId> {
    for i in 0..4 {
        let font = *fonts.add(i);
        let ttf_set = (*font).ttf;
        let first_ttf = (*ttf_set).fonts.as_mut_ptr();
        let last_ttf = first_ttf.add(4);
        if ttf >= first_ttf && ttf <= last_ttf {
            for j in 0..5 {
                if first_ttf.add(j) == ttf {
                    let ttf_data = std::slice::from_raw_parts((*ttf).raw_ttf, 0x100);
                    let hash = fxhash::hash64(ttf_data);
                    let scale = (*ttf).scale.to_bits();
                    return Some(FontId(hash, scale, j as u8));
                }
            }
        }
    }
    None
}

/// A struct to manage SDF cache being loaded in one thread while
/// other threads may potentially have to wait for it.
/// This assumes that init thread calls `InitSdfCache::lock_owned`
/// before any other thread calls `InitSdfCache::get`, and sets
/// the initial cache object to `Some` before releasing the lock.
pub struct InitSdfCache {
    cache: Mutex<Option<SdfCache>>,
}

/// Allows passing a locked mutex guard (assuming it is Send)
/// to another thread - which is good for us as locking mutexes
/// in async thread can be really problematic.
pub struct OwnedMutexGuard<O, T: 'static> {
    object: ManuallyDrop<Arc<O>>,
    guard: ManuallyDrop<MutexGuard<'static, T>>,
}

impl<O, T: 'static> std::ops::Deref for OwnedMutexGuard<O, T> {
    type Target = T;
    fn deref(&self) -> &Self::Target {
        &*self.guard
    }
}

impl<O, T: 'static> std::ops::DerefMut for OwnedMutexGuard<O, T> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut *self.guard
    }
}

impl<O, T: 'static> Drop for OwnedMutexGuard<O, T> {
    fn drop(&mut self) {
        unsafe {
            ManuallyDrop::drop(&mut self.guard);
            ManuallyDrop::drop(&mut self.object);
        }
    }
}

impl InitSdfCache {
    pub fn new() -> InitSdfCache {
        InitSdfCache {
            cache: Mutex::new(None),
        }
    }

    pub fn lock_owned(self: Arc<Self>) -> OwnedMutexGuard<Self, Option<SdfCache>> {
        unsafe {
            let guard = self.cache.lock();
            OwnedMutexGuard {
                guard: ManuallyDrop::new(
                    std::mem::transmute::<MutexGuard<'_, _>, MutexGuard<'static, _>>(guard)
                ),
                object: ManuallyDrop::new(self),
            }
        }
    }

    pub fn lock(&self) -> MappedMutexGuard<SdfCache> {
        let guard = self.cache.lock();
        MutexGuard::map(guard, |x| x.as_mut().expect("SDF Cache wasn't initialized?"))
    }
}

pub struct SdfCache {
    path: PathBuf,
    dirty: bool,
    load_failed: bool,
    /// Key is (font id, character)
    glyphs: FxHashMap<(FontId, u32), SdfBuffer>,
    data: Vec<u8>,
    /// Some hash that ideally would change whenever the executable has changed.
    /// As this cache does not know all parameters that the game uses to render
    /// SDFs, we'll just assume that the parameters stay same for a single version
    /// of the exe, and invalidate the cache when the exe is updated.
    ///
    /// Deciding what this hash exactly is does not concern this module.
    /// (But anyway we hash first 0x400 bytes of the exe's PE header for this)
    exe_hash: u32,
}

/// SDF data is 8bpp, so data.len() == width * height
struct SdfBuffer {
    width: u16,
    height: u16,
    data_offset: u32,
}

struct CachedSdf<'a> {
    width: u16,
    height: u16,
    data: &'a [u8],
}

struct VacantSdfEntry<'a> {
    entry: hash_map::VacantEntry<'a, (FontId, u32), SdfBuffer>,
    data: &'a mut Vec<u8>,
    dirty: &'a mut bool,
}

enum SdfCacheResult<'a> {
    Cached(CachedSdf<'a>),
    Missing(VacantSdfEntry<'a>),
}

/// Fonts are identified by hash of 100 first bytes of TTF data,
/// scale (raw f32)
/// and TTF variation which is another index withing TTF data
/// (Though afaik the variation is always same?)
#[derive(Copy, Clone, Eq, PartialEq, Debug, Hash)]
struct FontId(u64, u32, u8);

// File format:
// u32 exe_hash (resetting cache every SCR patch)
// u32 data_len
// u32 sdf_count
// {
//      (u64, u8) font_id
//      u32 glyph
//      u16 width
//      u16 height
//      u32 offset
// } sdfs[sdf_count]
// u8 data[data_len]

impl SdfCache {
    /// Initializes the SDF cache from the on-disk file.
    /// If it fails to load for some reason, initializes a dummy one so that
    /// we don't have to crash here.
    pub async fn init(exe_hash: u32) -> SdfCache {
        let args = crate::parse_args();
        let mut path = args.user_data_path.clone();
        path.push("sdf_cache.dat");
        if !path.exists() {
            return SdfCache::empty(path, exe_hash);
        }
        match SdfCache::open(&path, exe_hash).await {
            Ok(o) => o,
            Err(e) => {
                warn!("Couldn't open SDF cache: {}", e);
                if e.kind() == io::ErrorKind::PermissionDenied {
                    // Cache may be being written by another process, so prefer just
                    // having this process not write cache at all over starting a
                    // new cache from nothing.
                    let mut result = SdfCache::empty(PathBuf::new(), 0);
                    result.load_failed = true;
                    result
                } else {
                    // Assuming corrupted cache, so reset it
                    SdfCache::empty(path, exe_hash)
                }
            }
        }
    }

    pub fn empty(path: PathBuf, exe_hash: u32) -> SdfCache {
        SdfCache {
            path,
            dirty: false,
            load_failed: false,
            glyphs: Default::default(),
            data: Default::default(),
            exe_hash,
        }
    }

    pub async fn open(path: &Path, exe_hash: u32) -> io::Result<SdfCache> {
        let mut file = BufReader::new(fs::File::open(path).await?);
        let mut header = [0u8; 12];
        file.read_exact(&mut header).await?;
        let cache_hash = LittleEndian::read_u32(&header[..4]);
        let data_len = LittleEndian::read_u32(&header[4..8]) as usize;
        let sdf_count = LittleEndian::read_u32(&header[8..12]) as usize;

        if exe_hash != cache_hash {
            info!(
                "Exe hash has changed, invalidating SDF cache ({:08x} vs {:08x})",
                exe_hash, cache_hash,
            );
            return Ok(SdfCache::empty(path.into(), exe_hash));
        }
        let mut glyph_data = vec![0u8; sdf_count * 25];
        file.read_exact(&mut glyph_data[..]).await?;
        let mut data = vec![0u8; data_len];
        file.read_exact(&mut data[..]).await?;
        drop(file);
        let mut glyphs = FxHashMap::with_capacity_and_hasher(sdf_count, Default::default());
        for sdf in glyph_data.chunks_exact(25) {
            let hash = LittleEndian::read_u64(&sdf[..]);
            let scale = LittleEndian::read_u32(&sdf[8..]);
            let key = (FontId(hash, scale, sdf[12]), LittleEndian::read_u32(&sdf[13..]));
            let value = SdfBuffer {
                width: LittleEndian::read_u16(&sdf[17..]),
                height: LittleEndian::read_u16(&sdf[19..]),
                data_offset: LittleEndian::read_u32(&sdf[21..]),
            };
            let end = (value.data_offset as usize)
                .wrapping_add(value.width as usize * value.height as usize);
            if value.data_offset as usize >= data.len() || end > data.len() {
                return Err(io::Error::new(io::ErrorKind::Other, "Corrupted file"));
            }
            glyphs.insert(key, value);
        }
        Ok(SdfCache {
            path: path.into(),
            dirty: false,
            load_failed: false,
            glyphs,
            data,
            exe_hash,
        })
    }

    fn get<'a>(&'a mut self, font_id: FontId, glyph: u32) -> SdfCacheResult<'a> {
        match self.glyphs.entry((font_id, glyph)) {
            hash_map::Entry::Vacant(entry) => {
                SdfCacheResult::Missing(VacantSdfEntry {
                    entry,
                    data: &mut self.data,
                    dirty: &mut self.dirty,
                })
            }
            hash_map::Entry::Occupied(entry) => {
                let value = entry.get();
                let length = value.width as usize * value.height as usize;
                let data = &self.data[(value.data_offset as usize)..][..length];
                SdfCacheResult::Cached(CachedSdf {
                    width: value.width,
                    height: value.height,
                    data,
                })
            }
        }
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    pub async fn write_to_disk(&mut self) -> io::Result<()> {
        if self.load_failed {
            // Don't write to disk if reading from there failed for some reason
            return Ok(());
        }
        if self.data.len() > MAX_CACHE_SIZE_BYTES {
            // Reset the cache if it gets too big
            self.data.clear();
            self.glyphs.clear();
        }
        debug!("Writing {} pixels of SDF data", self.data.len());
        let capacity = 12 + self.data.len() + self.glyphs.len() * 25;
        let mut buffer = Vec::with_capacity(capacity);
        WriteBytesExt::write_u32::<LittleEndian>(&mut buffer, self.exe_hash)?;
        WriteBytesExt::write_u32::<LittleEndian>(&mut buffer, self.data.len() as u32)?;
        WriteBytesExt::write_u32::<LittleEndian>(&mut buffer, self.glyphs.len() as u32)?;
        let mut glyph_data = [0u8; 25];
        for (key, val) in self.glyphs.iter() {
            LittleEndian::write_u64(&mut glyph_data[0..], (key.0).0);
            LittleEndian::write_u32(&mut glyph_data[8..], (key.0).1);
            glyph_data[12] = (key.0).2;
            LittleEndian::write_u32(&mut glyph_data[13..], key.1);
            LittleEndian::write_u16(&mut glyph_data[17..], val.width);
            LittleEndian::write_u16(&mut glyph_data[19..], val.height);
            LittleEndian::write_u32(&mut glyph_data[21..], val.data_offset);
            buffer.extend_from_slice(&glyph_data[..]);
        }
        buffer.extend_from_slice(&self.data);
        let mut file = fs::File::create(&self.path).await?;
        file.write_all(&buffer).await?;
        debug_assert_eq!(buffer.len(), capacity);
        debug!("SDF cache written");
        self.dirty = false;
        Ok(())
    }
}

impl<'a> VacantSdfEntry<'a> {
    pub fn insert(self, width: u16, height: u16, data: &[u8]) {
        let data_offset = self.data.len() as u32;
        self.data.extend_from_slice(data);
        self.entry.insert(SdfBuffer {
            width,
            height,
            data_offset,
        });
        *self.dirty = true;
    }
}
