//! SC:R shader replacing code. Debug builds are compiled to support hot reloading
//! of shaders, release builds always just serve precompiled binary data.
//!
//! See docs/scr-prism-shaders.md for the full table of SC:R's pixel shader ids and
//! the constraints on replacing them (entry counts, shader models, G-buffer contract).

use super::scr;

#[cfg(debug_assertions)]
use parking_lot::Mutex;
#[cfg(debug_assertions)]
use std::path::{Path, PathBuf};
#[cfg(debug_assertions)]
use std::time::{Duration, Instant, SystemTime};

const fn pixel_sm4(wrapper: &[u8]) -> scr::PrismShader {
    scr::PrismShader {
        api_type: scr::PRISM_SHADER_API_SM4,
        shader_type: scr::PRISM_SHADER_TYPE_PIXEL,
        unk: [0; 6],
        data: wrapper.as_ptr(),
        data_len: wrapper.len() as u32,
    }
}

const fn pixel_sm5(wrapper: &[u8]) -> scr::PrismShader {
    scr::PrismShader {
        api_type: scr::PRISM_SHADER_API_SM5,
        shader_type: scr::PRISM_SHADER_TYPE_PIXEL,
        unk: [0; 6],
        data: wrapper.as_ptr(),
        data_len: wrapper.len() as u32,
    }
}

/// A pixel shader set replacing SC:R's own for one shader id.
struct PatchedShader {
    id: u8,
    /// The entries the build script compiled.
    shaders: &'static [scr::PrismShader],
    #[cfg(debug_assertions)]
    source: ShaderSource,
}

/// Where a replacement is compiled from, for rereading it as it changes.
#[cfg(debug_assertions)]
#[derive(Clone, Copy)]
struct ShaderSource {
    /// The HLSL file's name in `src/bw_scr/shaders`, without its extension.
    name: &'static str,
    /// What the SM4 entry is compiled as. A device below Direct3D feature level 10 can only run
    /// one that is a level-9 container, as SC:R's own are.
    sm4_model: compile_shaders::ShaderModel,
}

/// The replacement for shader `$id` compiled from `src/bw_scr/shaders/$name.hlsl`, with its SM4
/// entry built as `$sm4_model`, which `SOURCES` in `build.rs` has to list the same way.
macro_rules! patched {
    ($id:literal, $name:literal, $sm4_model:ident) => {
        PatchedShader {
            id: $id,
            shaders: &[
                pixel_sm4(include_bytes!(concat!(
                    env!("OUT_DIR"),
                    "/",
                    $name,
                    ".sm4.bin"
                ))),
                pixel_sm5(include_bytes!(concat!(
                    env!("OUT_DIR"),
                    "/",
                    $name,
                    ".sm5.bin"
                ))),
            ],
            #[cfg(debug_assertions)]
            source: ShaderSource {
                name: $name,
                sm4_model: compile_shaders::ShaderModel::$sm4_model,
            },
        }
    };
}

static PATCHED_SHADERS: &[PatchedShader] = &[
    patched!(0x00, "texture", Sm4Level9),
    patched!(0x04, "vertex_colored", Sm4Level9),
    patched!(0x1c, "mask", Sm4),
];

/// A replacement as currently compiled from its source, which is reread whenever the file changes.
#[cfg(debug_assertions)]
struct LiveShader {
    id: u8,
    shaders: &'static [scr::PrismShader],
    /// The source file, when it exists on this system, with the modification time it was last
    /// compiled at.
    source: Option<(PathBuf, SystemTime, compile_shaders::ShaderModel)>,
}

#[cfg(debug_assertions)]
pub struct ShaderReplaces {
    shaders: Mutex<Vec<LiveShader>>,
    // Update checking requires windows i/o for every shader file, doing that every
    // rendered frame is likely a bit excessive.
    update_throttle: Mutex<Instant>,
}

#[cfg(not(debug_assertions))]
pub struct ShaderReplaces;

#[cfg(debug_assertions)]
impl ShaderReplaces {
    pub fn new() -> ShaderReplaces {
        let shaders_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/bw_scr/shaders");
        let shaders = PATCHED_SHADERS
            .iter()
            .map(|patched| {
                let source = patched.source;
                let path = shaders_root.join(format!("{}.hlsl", source.name));
                if let Some((shader, timestamp)) =
                    compile_shader_retry_on_err(&path, source.sm4_model)
                {
                    LiveShader {
                        id: patched.id,
                        shaders: shader,
                        source: Some((path, timestamp, source.sm4_model)),
                    }
                } else {
                    LiveShader {
                        id: patched.id,
                        shaders: patched.shaders,
                        source: None,
                    }
                }
            })
            .collect();

        ShaderReplaces {
            shaders: Mutex::new(shaders),
            update_throttle: Mutex::new(Instant::now()),
        }
    }

    pub fn iter_shaders(&self) -> impl Iterator<Item = (u8, &'static [scr::PrismShader])> + use<> {
        let result = {
            let mut shaders = self.shaders.lock();
            for live in shaders.iter_mut() {
                if let Some((ref path, ref mut time, sm4_model)) = live.source
                    && let Some(new_time) = file_changed_time(path)
                    && new_time != *time
                    && let Some((shader, new_time)) = compile_shader_retry_on_err(path, sm4_model)
                {
                    debug!("Recompiled shader {}", path.display());
                    live.shaders = shader;
                    *time = new_time;
                }
            }
            shaders
                .iter()
                .map(|live| (live.id, live.shaders))
                .collect::<Vec<_>>()
        };
        result.into_iter()
    }

    pub fn has_changed(&self) -> bool {
        let now = Instant::now();
        let mut last_check = self.update_throttle.lock();
        if now.duration_since(*last_check) < Duration::from_millis(500) {
            return false;
        }
        *last_check = now;
        let shaders = self.shaders.lock();
        shaders
            .iter()
            .filter_map(|live| live.source.as_ref())
            .any(|(path, time, _)| {
                if let Some(new_time) = file_changed_time(path) {
                    new_time != *time
                } else {
                    false
                }
            })
    }
}

/// Returns None if the shader file does not exist. (That is, the debug dll was distributed
/// to some other system than the one it was compiled on)
/// On compile errors shows the error with a message box and rereads the until
/// the shader compiles
#[cfg(debug_assertions)]
fn compile_shader_retry_on_err(
    path: &Path,
    sm4_model: compile_shaders::ShaderModel,
) -> Option<(&'static [scr::PrismShader], SystemTime)> {
    use compile_shaders::{ShaderModel, ShaderType};
    use std::fs;
    use std::io::Read;
    if !path.exists() {
        return None;
    }
    let dir = path.parent()?;
    loop {
        let result = fs::File::open(path).and_then(|mut file| {
            let metadata = file.metadata()?;
            let modified = metadata.modified()?;
            let mut buffer = Vec::new();
            file.read_to_end(&mut buffer)?;
            let sm4 = compile_shaders::compile(&buffer, &[], dir, ShaderType::Pixel, sm4_model)?;
            let sm5 =
                compile_shaders::compile(&buffer, &[], dir, ShaderType::Pixel, ShaderModel::Sm5)?;

            // Just leak the shaders as I cannot be too sure
            // that deallocating old shaders is safe; SC:R may keep
            // some handles to them for a while or something.
            // And the memory leaked isn't that many bytes.
            let result = vec![
                pixel_sm4(compile_shaders::wrap_prism_shader(&sm4.shader)?.leak()),
                pixel_sm5(compile_shaders::wrap_prism_shader(&sm5.shader)?.leak()),
            ];
            Ok((&*result.leak(), modified))
        });
        match result {
            Ok(o) => return Some(o),
            Err(e) => {
                let msg = format!(
                    "Shader compilation failed.\n\
                    File {}\n\
                    {}",
                    path.display(),
                    e
                );
                crate::windows::message_box("Shieldbattery", &msg);
            }
        }
    }
}

#[cfg(debug_assertions)]
fn file_changed_time(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|x| x.modified()).ok()
}

#[cfg(not(debug_assertions))]
impl ShaderReplaces {
    pub fn new() -> ShaderReplaces {
        ShaderReplaces
    }

    pub fn iter_shaders(&self) -> impl Iterator<Item = (u8, &'static [scr::PrismShader])> {
        PATCHED_SHADERS
            .iter()
            .map(|patched| (patched.id, patched.shaders))
    }

    pub fn has_changed(&self) -> bool {
        false
    }
}
