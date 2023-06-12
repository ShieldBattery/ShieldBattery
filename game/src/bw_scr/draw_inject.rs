use std::mem;
use std::ptr::{self, addr_of_mut, null_mut};

use bytemuck::{Pod, Zeroable};
use egui::{TexturesDelta, TextureId};
use egui::epaint;
use egui::epaint::textures::{TextureFilter};
use hashbrown::HashMap;
use quick_error::{quick_error};

use super::bw_vector::{bw_vector_push, bw_vector_reserve};
use super::draw_overlay;
use super::scr;

macro_rules! warn_once {
    ($($tokens:tt)*) => {{
        // This is probably spammy if it ever happens, warning only once
        static ONCE: std::sync::Once = std::sync::Once::new();
        ONCE.call_once(|| warn!($($tokens)*));
    }}
}

/// State persisted across draws
pub struct RenderState {
    textures: HashMap<TextureId, OwnedBwTexture>,
    queued_texture_frees: Vec<OwnedBwTexture>,
    temp_buffer: Vec<u8>,
}

/// Most of this isn't probably safe to use outside renderer (main) thread,
/// but will have to implement this anyway to have it be storable
/// in global BwScr.
unsafe impl Send for RenderState {}
unsafe impl Sync for RenderState {}

impl RenderState {
    pub fn new() -> RenderState {
        RenderState {
            textures: HashMap::with_capacity(16),
            queued_texture_frees: Vec::new(),
            temp_buffer: Vec::new(),
        }
    }
}

const EMPTY_SUB_COMMANDS: scr::DrawSubCommands = scr::DrawSubCommands {
    unk: 0,
    first: null_mut(),
};

quick_error! {
    #[derive(Debug)]
    pub enum DrawError {
        OutOfDrawCommands {
            display("Ran out of draw commands")
        }
        OutOfSubCommandBuffer {
            display("Ran out of subcommand buffer")
        }
        InvalidTexture(id: TextureId) {
            display("Invalid texture ID {:?}", id)
        }
    }
}

pub struct RenderTarget {
    pub bw: *mut scr::RenderTarget,
    pub id: u32,
    /// 1.0 / scaled_render_target_width
    /// Where scaled width / height are determined so that if height is above 1080, and
    /// width is a value matching 1080 height so that the aspect ratio is kept.
    /// Used for egui <-> bw coordinate translations.
    pub w_recip: f32,
    pub h_recip: f32,
    /// 1.0 / render_target_width
    /// Used for BW-visible shader constants
    /// (may be unused depending on shader, but BW sets it always so we may as well too do that)
    pub bw_w_recip: f32,
    pub bw_h_recip: f32,
}

impl RenderTarget {
    pub unsafe fn new(bw: *mut scr::RenderTarget, id: u32) -> RenderTarget {
        let width = (*bw).width as f32;
        let height = (*bw).height as f32;
        // FIXME: This is more or less duplicating logic in draw_overlay::OverlayState::step,
        // (And assuming the render target sizes here are same as the values passed to step())
        // would be more cleaner to have the egui-visible width/height be passed from there.
        let (scale, h_recip) = if height > 1080.0 {
            (height / 1080.0, 1.0 / 1080.0)
        } else {
            (1.0, 1.0 / height)
        };
        let w_recip = 1.0 / (width / scale);
        RenderTarget {
            bw,
            id,
            w_recip,
            h_recip,
            bw_w_recip: 1.0 / width,
            bw_h_recip: 1.0 / height,
        }
    }
}

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
struct ColoredVertex {
    pos: [f32; 2],
    texture: [f32; 2],
    color: u32,
}

struct VertexBufferAlloc<T> {
    data: *mut T,
    byte_offset: usize,
    length: usize,
}

impl<T: Copy + bytemuck::NoUninit + bytemuck::AnyBitPattern> VertexBufferAlloc<T> {
    fn set_map<F, const N: usize>(&self, amount: usize, mut func: F)
    where F: FnMut(usize) -> [T; N]
    {
        assert!(amount * N <= self.length);
        unsafe {
            let mut pos = self.data;
            for i in 0..amount {
                let data = func(i);
                ptr::copy_nonoverlapping(data.as_ptr(), pos, N);
                pos = pos.add(N);
            }
        }
    }

    fn zero_after(&self, pos: usize) {
        unsafe {
            if pos < self.length {
                let zero_amount = self.length - pos;
                let slice = std::slice::from_raw_parts_mut(self.data.add(pos), zero_amount);
                let slice: &mut [u8] = bytemuck::cast_slice_mut(slice);
                slice.fill(0u8);
            }
        }
    }
}

fn egui_vertex_to_colored_vertex(
    render_target: &RenderTarget,
    vertex: &epaint::Vertex,
) -> ColoredVertex {
    ColoredVertex {
        // egui vertex position is in 0.0 .. screen_points range with origin in top left,
        // while BW wants the vertex in 0.0 .. 1.0 range with origin in bottom left
        pos: [vertex.pos.x * render_target.w_recip, 1.0 - vertex.pos.y * render_target.h_recip],
        texture: [vertex.uv.x, vertex.uv.y],
        color: u32::from_le_bytes(vertex.color.to_array()),
    }
}

/// Bw globals used by add_overlays
pub struct BwVars {
    pub renderer: *mut scr::Renderer,
    pub commands: *mut scr::DrawCommands,
    pub vertex_buf: *mut scr::VertexBuffer,
    pub statres_icons: *mut scr::DdsGrpSet,
    pub cmdicons: *mut scr::DdsGrpSet,
    pub is_hd: bool,
    pub is_carbot: bool,
}

pub unsafe fn add_overlays(
    state: &mut RenderState,
    bw: &BwVars,
    overlay_out: draw_overlay::StepOutput,
    render_target: &RenderTarget,
) {
    update_textures(bw.renderer, state, &overlay_out.textures_delta);
    // First layer that is drawn above minimap (Or maybe a tie with later draw taking prioriry)
    // But also it'll be drawn over menus which is maybe not too nice?
    // 0x15 is above F10 menu already
    let layer = 0x1a;
    for primitive in overlay_out.primitives.into_iter() {
        match primitive.primitive {
            epaint::Primitive::Mesh(mesh) => {
                if let Err(e) =
                    draw_egui_mesh(layer, state, mesh, bw, render_target, &primitive.clip_rect)
                {
                    warn_once!("Failed to draw mesh: {e}");
                }
            }
            epaint::Primitive::Callback(..) => {
                // Probably not going to get created without ui code explicitly
                // asking for PaintCallback?
                warn_once!("Unimplemented paint callback");
            }
        }
    }
    queue_free_textures(state, &overlay_out.textures_delta);
}

trait IndexSize: Copy {
    fn to_u16(self) -> u16;
}

impl IndexSize for u32 {
    fn to_u16(self) -> u16 {
        self as u16
    }
}

impl IndexSize for u16 {
    fn to_u16(self) -> u16 {
        self
    }
}

fn align4(val: u32) -> u32 {
    (val.wrapping_sub(1) | 3).wrapping_add(1)
}

fn align6(val: u32) -> u32 {
    let rem = val % 6;
    if rem == 0 {
        val
    } else {
        val + (6 - rem)
    }
}

unsafe fn draw_overlay_texture_ptr(
    bw: &BwVars,
    egui_user_id: u64,
) -> Option<*mut scr::RendererTexture> {
    use draw_overlay::Texture;
    match Texture::from_egui_user_id(egui_user_id)? {
        Texture::StatRes(frame) => ddsgrp_frame(bw.statres_icons, bw, frame),
        Texture::CmdIcon(frame) => ddsgrp_frame(bw.cmdicons, bw, frame),
    }
}

unsafe fn ddsgrp_frame(
    grp: *mut scr::DdsGrpSet,
    bw: &BwVars,
    frame: u16,
) -> Option<*mut scr::RendererTexture> {
    let index = match (bw.is_hd, bw.is_carbot) {
        (false, _) => 0,
        (true, false) => 1,
        (true, true) => 2,
    };
    let ddsgrp = addr_of_mut!((*grp).dds_grps[index]);
    if frame >= (*ddsgrp).frame_count || (*ddsgrp).textures.is_null() {
        return None;
    }
    let texture = (*ddsgrp).textures.add(frame as usize);
    let renderer_texture = (*texture).renderer_texture;
    if renderer_texture.is_null() {
        return None;
    }
    Some(renderer_texture)
}

unsafe fn draw_egui_mesh(
    layer: u16,
    state: &mut RenderState,
    mesh: epaint::Mesh,
    bw: &BwVars,
    render_target: &RenderTarget,
    clip_rect: &egui::Rect,
) -> Result<(), DrawError> {
    let texture = match mesh.texture_id {
        TextureId::Managed(_) => {
            state.textures.get(&mesh.texture_id)
                .map(|x| x.bw())
        }
        TextureId::User(id) => draw_overlay_texture_ptr(bw, id),
    }.ok_or_else(|| DrawError::InvalidTexture(mesh.texture_id))?;
    if mesh.vertices.len() < 0x10000 {
        draw_egui_mesh_main(
            layer,
            &mesh.indices,
            &mesh.vertices,
            texture,
            bw,
            render_target,
            clip_rect,
        )
    } else {
        for mesh in mesh.split_to_u16() {
            draw_egui_mesh_main(
                layer,
                &mesh.indices,
                &mesh.vertices,
                texture,
                bw,
                render_target,
                clip_rect,
            )?;
        }
        Ok(())
    }
}

unsafe fn draw_egui_mesh_main<I: IndexSize>(
    layer: u16,
    indices: &[I],
    vertices: &[epaint::Vertex],
    texture: *mut scr::RendererTexture,
    bw: &BwVars,
    render_target: &RenderTarget,
    clip_rect: &egui::Rect,
) -> Result<(), DrawError> {
    // Bw requires there to be some `quad_count`, and
    // vertex count being `4 * quad_count` and
    // index count being `6 * quad_count`.
    let init_vertex_count = align4(vertices.len() as u32);
    let init_index_count = align6(indices.len() as u32);
    let quad_count = (init_vertex_count / 4).max(init_index_count / 6);
    let vertex_count = quad_count * 4;
    let index_count = quad_count * 6;
    let vertex_alloc = allocate_vertices(bw.vertex_buf, 0x8, vertex_count);
    let index_alloc = allocate_indices(bw.vertex_buf, index_count);
    vertex_alloc.set_map(vertices.len(), |i| {
        bytemuck::cast::<ColoredVertex, [f32; 5]>(
            egui_vertex_to_colored_vertex(render_target, &vertices[i])
        )
    });
    index_alloc.set_map(indices.len(), |i| [indices[i].to_u16()]);
    index_alloc.zero_after(indices.len());

    let revert_pos = (*bw.commands).draw_command_count;
    let draw_command = new_draw_command(bw.commands, layer).ok_or(DrawError::OutOfDrawCommands)?;
    *draw_command = scr::DrawCommand {
        render_target_id: render_target.id,
        is_hd: bw.is_hd as u32,
        texture_ids: [0; 7],
        // Indexed quad
        draw_mode: 1,
        // colored_frag
        shader_id: 4,
        vertex_buffer_offset_bytes: vertex_alloc.byte_offset,
        index_buffer_offset_bytes: index_alloc.byte_offset,
        allocated_vertex_count: vertex_count,
        used_vertex_count: vertex_count,
        _unk3c: 0xffff,
        blend_mode: 0,
        subcommands_pre: EMPTY_SUB_COMMANDS,
        subcommands_post: EMPTY_SUB_COMMANDS,
        shader_constants: [0.0f32; 0x14],
    };
    (*draw_command).texture_ids[0] = texture as usize;
    // Set multiplyColor
    (*draw_command).shader_constants[0x0] = 1.0;
    (*draw_command).shader_constants[0x1] = 1.0;
    (*draw_command).shader_constants[0x2] = 1.0;
    (*draw_command).shader_constants[0x3] = 1.0;
    set_render_target_wh_recip(draw_command, render_target);
    // egui rect unit is points (Render target w/h) and l/t/r/b,
    // BW scissor rect is in 0.0 .. 1.0 range and x/y/w/h with origin in bottom left.
    let bw_clip_rect = [
        clip_rect.left() * render_target.w_recip,
        1.0 - clip_rect.bottom() * render_target.h_recip,
        clip_rect.width() * render_target.w_recip,
        clip_rect.height() * render_target.h_recip,
    ];
    if bw_clip_rect != [0.0f32, 0.0, 1.0, 1.0] {
        let result = (|| {
            add_draw_subcommand(
                bw.commands,
                addr_of_mut!((*draw_command).subcommands_pre),
                1,
                bw_clip_rect,
            )?;
            // Some renderer backends seem to need explicit scissor reset (Type 2 subcommand),
            // though prism seems to just implicitly reset it after every subcommand
            // and ignore this, but adding this to be consistent with how scissor is normally used
            add_draw_subcommand(
                bw.commands,
                addr_of_mut!((*draw_command).subcommands_post),
                2,
                (),
            )
        })();
        if result.is_err() {
            pop_draw_commands(bw.commands, revert_pos);
            return result;
        }
    }
    Ok(())
}

unsafe fn add_draw_subcommand<D: Pod>(
    alloc_buf: *mut scr::DrawCommands,
    subcommands: *mut scr::DrawSubCommands,
    id: u32,
    data: D,
) -> Result<(), DrawError> {
    let length = mem::size_of::<scr::DrawSubCommand>() + mem::size_of::<D>();
    let start_offset = (*alloc_buf).subcommand_buffer_bytes_used;
    let end_offset = start_offset.checked_add(length as u32)
        .filter(|&x| x <= (*alloc_buf).subcommand_buffer.len() as u32)
        .ok_or(DrawError::OutOfSubCommandBuffer)?;
    (*alloc_buf).subcommand_buffer_bytes_used = end_offset;
    let command = (*alloc_buf).subcommand_buffer.as_mut_ptr().add(start_offset as usize);
    (command as *mut scr::DrawSubCommand).write(scr::DrawSubCommand {
        id,
        next: null_mut(),
    });
    (command.add(mem::size_of::<scr::DrawSubCommand>()) as *mut D).write(data);

    // Insert at end of the single-linked list
    let mut insert_pos = addr_of_mut!((*subcommands).first);
    while !(*insert_pos).is_null() {
        insert_pos = addr_of_mut!((**insert_pos).next);
    }
    *insert_pos = command as *mut scr::DrawSubCommand;

    Ok(())
}

unsafe fn set_render_target_wh_recip(
    command: *mut scr::DrawCommand,
    render_target: &RenderTarget,
) {
    (*command).shader_constants[0xe] = render_target.bw_w_recip;
    (*command).shader_constants[0xf] = render_target.bw_h_recip;
}

unsafe fn new_draw_command(
    commands: *mut scr::DrawCommands,
    layer: u16,
) -> Option<*mut scr::DrawCommand> {
    let index = (*commands).draw_command_count as usize;
    if index >= (*commands).commands.len() {
        return None;
    }
    (*commands).draw_command_count = index as u16 + 1;
    let command = (*commands).commands.as_mut_ptr().add(index);
    let draw_sort = addr_of_mut!((*commands).draw_sort_vector) as *mut scr::BwVector;
    let draw_sort_index = (*draw_sort).length as u16;
    bw_vector_push(draw_sort, scr::DrawSort {
        layer,
        index: draw_sort_index,
        command,
    });

    Some(command)
}

unsafe fn pop_draw_commands(
    commands: *mut scr::DrawCommands,
    pos: u16,
) {
    let pop_amount = (*commands).draw_command_count - pos;
    let draw_sort = addr_of_mut!((*commands).draw_sort_vector) as *mut scr::BwVector;
    (*draw_sort).length -= pop_amount as usize;
    (*commands).draw_command_count = pos;
}

unsafe fn allocate_vertices(
    vertex_buf: *mut scr::VertexBuffer,
    floats_per_vertex: u32,
    vertex_count: u32,
) -> VertexBufferAlloc<f32> {
    let float_count = (vertex_count * floats_per_vertex) as usize;
    // BW makes alignment multiple of vertex byte size (floats_per_vertex * 4),
    // but it seems to be pointless? What would alignment of 0x14 help?
    // Going to just check that alignment is at 4 and not even trying to fix it
    // if not.
    let start_offset = (*vertex_buf).allocated_size_bytes;
    assert!(start_offset & 3 == 0, "Bad vertex alignment {:x}", start_offset);
    let end_offset = start_offset + float_count * 4;
    while end_offset > vertex_buf_capacity_bytes(vertex_buf) {
        vertex_buf_grow(vertex_buf);
    }
    (*vertex_buf).allocated_size_bytes = end_offset;
    let data = ((*vertex_buf).buffer.data as *mut u8).add(start_offset) as *mut f32;
    VertexBufferAlloc {
        data,
        byte_offset: start_offset,
        length: float_count,
    }
}

unsafe fn vertex_buf_capacity_bytes(vertex_buf: *mut scr::VertexBuffer) -> usize {
    (*vertex_buf).buffer_size_u32s * 4
}

unsafe fn allocate_indices(
    vertex_buf: *mut scr::VertexBuffer,
    count: u32,
) -> VertexBufferAlloc<u16> {
    let start_offset = (*vertex_buf).index_buffer_allocated_bytes;
    assert!(start_offset & 1 == 0, "Bad index alignment {:x}", start_offset);
    let end_offset = start_offset + count as usize * 2;
    while end_offset > index_buf_capacity_bytes(vertex_buf) {
        index_buf_grow(vertex_buf);
    }
    (*vertex_buf).index_buffer_allocated_bytes = end_offset;
    let data = ((*vertex_buf).index_buffer.data as *mut u8).add(start_offset) as *mut u16;
    VertexBufferAlloc {
        data,
        byte_offset: start_offset,
        length: count as usize,
    }
}

unsafe fn index_buf_capacity_bytes(vertex_buf: *mut scr::VertexBuffer) -> usize {
    (*vertex_buf).index_buf_size_u16s * 2
}

#[cold]
unsafe fn vertex_buf_grow(vertex_buf: *mut scr::VertexBuffer) {
    // You may think that this should check if heap_allocated was
    // 0 and not assume that there's a vector to be freed..
    // But it doesn't work like that for some reason
    // Maybe `heap_allocated` is wrong name? Maybe it should
    // be buffer_inited or something. Can probably also just always
    // assume it to be 1 anyway.
    let new_capacity = (*vertex_buf).buffer_size_u32s * 2;
    (*vertex_buf).buffer_size_u32s = new_capacity;
    (*vertex_buf).heap_allocated = 1;
    let vector = addr_of_mut!((*vertex_buf).buffer);
    bw_vector_reserve::<f32>(vector, new_capacity);
    (*vector).length = new_capacity;
}

#[cold]
unsafe fn index_buf_grow(vertex_buf: *mut scr::VertexBuffer) {
    let new_capacity = (*vertex_buf).index_buf_size_u16s * 2;
    (*vertex_buf).index_buf_size_u16s = new_capacity;
    (*vertex_buf).index_buf_heap_allocated = 1;
    let vector = addr_of_mut!((*vertex_buf).index_buffer);
    bw_vector_reserve::<u16>(vector, new_capacity);
    (*vector).length = new_capacity;
}

/// Releases texture on drop,
struct OwnedBwTexture {
    texture: *mut scr::RendererTexture,
    renderer: *mut scr::Renderer,
    filtering: u8,
    format: u8,
    wrap_mode: u8,
}

impl OwnedBwTexture {
    pub unsafe fn new_rgba(
        renderer: *mut scr::Renderer,
        size: (u32, u32),
        data: &[u8],
        bilinear: bool,
    ) -> Option<OwnedBwTexture> {
        // Format 0 = RGBA, 1 = BGRA, 2 = DXT1, 3 = DXT5, 4 = R (Single channel), 5 = RGBA16f
        let format = 0;
        let filtering = if bilinear { 1 } else { 0 };
        // Wrap 0 = clamp, 1 = repeat, 2 = mirrored repeat
        let wrap_mode = 0;
        if data.len() != 4 * (size.0 * size.1) as usize {
            return None;
        }
        let texture = (*(*renderer).vtable).create_texture.call8(
            renderer,
            format,
            data.as_ptr(),
            data.len(),
            size.0,
            size.1,
            filtering,
            wrap_mode,
        );
        if texture.is_null() {
            None
        } else {
            Some(OwnedBwTexture {
                texture,
                renderer,
                filtering: filtering as u8,
                format: format as u8,
                wrap_mode: wrap_mode as u8,
            })
        }
    }

    fn bw(&self) -> *mut scr::RendererTexture {
        self.texture
    }

    fn update(&self, data: &[u8], pos: (u32, u32), size: (u32, u32)) {
        unsafe {
            if data.len() != 4 * (size.0 * size.1) as usize {
                warn!("Invalid data passed to OwnedBwTexture::update");
                return;
            }
            update_texture(
                self.renderer,
                self.texture,
                data,
                size.0,
                pos,
                size,
                self.format as u32,
                self.filtering as u32,
                self.wrap_mode as u32,
            );
        }
    }

    fn intentional_drop(mut self) {
        unsafe {
            (*(*self.renderer).vtable).delete_texture.call2(self.renderer, &mut self.texture);
        }
        // Skip destructor which is used for catching unintended drops.
        let _ = mem::ManuallyDrop::new(self);
    }
}

impl Drop for OwnedBwTexture {
    fn drop(&mut self) {
        // I think it's better to leak and hope that system resources don't run
        // out rather than crash due to BW code accessing this texture.
        // (But of crashing on debug builds)
        // Use self.intentional_drop() when it is known that this value is safe
        // to drop.
        debug_assert!(false, "OwnedBwTexture leak");
        error!("Leaking an OwnedBwTexture");
    }
}

unsafe fn update_texture(
    renderer: *mut scr::Renderer,
    texture: *mut scr::RendererTexture,
    data: &[u8],
    row_length: u32,
    pos: (u32, u32),
    size: (u32, u32),
    format: u32,
    filtering: u32,
    wrap_mode: u32,
) {
    (*(*renderer).vtable).update_texture.call11(
        renderer,
        texture,
        pos.0,
        pos.1,
        size.0,
        size.1,
        data.as_ptr(),
        row_length,
        format,
        filtering,
        wrap_mode,
    );
}

unsafe fn update_textures(
    renderer: *mut scr::Renderer,
    state: &mut RenderState,
    delta: &TexturesDelta,
) {
    for &(id, ref delta) in &delta.set {
        // Not really sure which is best way to handle this since BW will only
        // accept one filtering mode instead of min/mag split.
        let bilinear = delta.options.magnification == TextureFilter::Linear ||
            delta.options.minification == TextureFilter::Linear;
        let size = delta.image.size();
        let size = (size[0] as u32, size[1] as u32);
        let rgba = egui_image_data_to_rgba(&delta.image, &mut state.temp_buffer);
        if let Some(pos) = delta.pos {
            if let Some(texture) = state.textures.get(&id) {
                texture.update(rgba, (pos[0] as u32, pos[1] as u32), size);
            } else {
                warn_once!("Tried to update nonexistent texture {id:?}");
            }
        } else {
            if let Some(texture) = OwnedBwTexture::new_rgba(renderer, size, rgba, bilinear) {
                if let Some(old) = state.textures.insert(id, texture) {
                    state.queued_texture_frees.push(old);
                }
            } else {
                error!("Could not create texture of size {size:?}");
            }
        }
    }
}

fn egui_image_data_to_rgba<'a>(image: &'a epaint::ImageData, buffer: &'a mut Vec<u8>) -> &'a [u8] {
    match image {
        epaint::ImageData::Color(image) => {
            bytemuck::cast_slice(&image.pixels)
        }
        epaint::ImageData::Font(image) => {
            buffer.clear();
            buffer.reserve(image.pixels.len() * 4);
            for pixel in image.srgba_pixels(None) {
                buffer.extend_from_slice(bytemuck::bytes_of(&pixel));
            }
            &buffer[..]
        }
    }
}

/// The textures cannot be freed until BW has issued a render call, so move them
/// to a vec that will be freed afterwards.
fn queue_free_textures(state: &mut RenderState, delta: &TexturesDelta) {
    for &id in &delta.free {
        if let Some(texture) = state.textures.remove(&id) {
            state.queued_texture_frees.push(texture);
        }
    }
}

pub fn free_textures(state: &mut RenderState) {
    if !state.queued_texture_frees.is_empty() {
        for texture in state.queued_texture_frees.drain(..) {
            texture.intentional_drop();
        }
    }
}
