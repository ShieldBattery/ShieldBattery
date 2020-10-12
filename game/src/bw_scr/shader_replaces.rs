//! SC:R shader replacing code. Debug builds are compiled to support hot reloading
//! of shaders, release builds always just serve precompiled binary data.

use super::scr;

#[cfg(debug_assertions)]
use std::path::{Path, PathBuf};
#[cfg(debug_assertions)]
use std::time::{Duration, Instant, SystemTime};
#[cfg(debug_assertions)]
use parking_lot::Mutex;

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

static MASK_SM4_BIN: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/mask.sm4.bin"));
static MASK_SM5_BIN: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/mask.sm5.bin"));
static MASK: &[scr::PrismShader] = &[
    pixel_sm4(MASK_SM4_BIN),
    pixel_sm5(MASK_SM5_BIN),
];

static PATCHED_SHADERS: &[(u8, &[scr::PrismShader], &str)] = &[
    (0x1c, MASK, "mask"),
];

#[cfg(debug_assertions)]
pub struct ShaderReplaces {
    shaders: Mutex<Vec<(u8, &'static [scr::PrismShader], Option<(PathBuf, SystemTime)>)>>,
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
            .map(|&(id, default_source, name)| {
                let path = shaders_root.join(format!("{}.hlsl", name));
                if let Some((shader, timestamp)) = compile_shader_retry_on_err(&path) {
                    (id, shader, Some((path.into(), timestamp)))
                } else {
                    (id, default_source, None)
                }
            })
            .collect();

        ShaderReplaces {
            shaders: Mutex::new(shaders),
            update_throttle: Mutex::new(Instant::now()),
        }
    }

    pub fn iter_shaders(&self) -> impl Iterator<Item = (u8, &'static [scr::PrismShader])> {
        let result = {
            let mut shaders = self.shaders.lock();
            for &mut (_, ref mut data, ref mut path_time) in shaders.iter_mut() {
                if let Some((ref path, ref mut time)) = *path_time {
                    if let Some(new_time) = file_changed_time(path) {
                        if new_time != *time {
                            if let Some((shader, new_time)) =
                                compile_shader_retry_on_err(&path)
                            {
                                debug!("Recompiled shader {}", path.display());
                                *data = shader;
                                *time = new_time;
                            }
                        }
                    }
                }
            }
            shaders.iter().map(|&(id, data, _)| (id, data)).collect::<Vec<_>>()
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
            .filter_map(|x| x.2.as_ref())
            .any(|(path, time)| {
                if let Some(new_time) = file_changed_time(&path) {
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
fn compile_shader_retry_on_err(path: &Path) -> Option<(&'static [scr::PrismShader], SystemTime)> {
    use std::fs;
    use std::io::Read;
    use compile_shaders::{ShaderType, ShaderModel};
    if !path.exists() {
        return None;
    }
    let dir = path.parent()?;
    loop {
        let result = fs::File::open(path)
            .and_then(|mut file| {
                let metadata = file.metadata()?;
                let modified = metadata.modified()?;
                let mut buffer = Vec::new();
                file.read_to_end(&mut buffer)?;
                let sm4 = compile_shaders::compile(
                    &buffer,
                    &[],
                    dir,
                    ShaderType::Pixel,
                    ShaderModel::Sm4,
                )?;
                let sm5 = compile_shaders::compile(
                    &buffer,
                    &[],
                    dir,
                    ShaderType::Pixel,
                    ShaderModel::Sm5,
                )?;

                // Just leak the shaders as I cannot be too sure
                // that deallocating old shaders is safe; SC:R may keep
                // some handles to them for a while or something.
                // And the memory leaked isn't that many bytes.
                let result = vec![
                    pixel_sm4(compile_shaders::wrap_prism_shader(&sm4.shader).leak()),
                    pixel_sm5(compile_shaders::wrap_prism_shader(&sm5.shader).leak()),
                ];
                Ok((&*result.leak(), modified))
            });
        match result {
            Ok(o) => return Some(o),
            Err(e) => {
                let msg = format!("Shader compilation failed.\n\
                    File {}\n\
                    {}", path.display(), e);
                crate::windows::message_box("Shieldbattery", &msg);
            }
        }
    }
}

#[cfg(debug_assertions)]
fn file_changed_time(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(&path).and_then(|x| x.modified()).ok()
}

#[cfg(not(debug_assertions))]
impl ShaderReplaces {
    pub fn new() -> ShaderReplaces {
        ShaderReplaces
    }

    pub fn iter_shaders(&self) -> impl Iterator<Item = (u8, &'static [scr::PrismShader])> {
        PATCHED_SHADERS.iter().map(|x| (x.0, x.1))
    }

    pub fn has_changed(&self) -> bool {
        false
    }
}
