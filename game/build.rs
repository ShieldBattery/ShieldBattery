//! A build script that
//! 1) Generates rust code from protobufs
//! 2) Compiles d3d11 shaders for SC:R
//! 3) Gathers version information from package.json

use std::fs;
use std::path::Path;

use anyhow::{Context, Error};

use compile_shaders::{ShaderModel, ShaderType};

#[allow(clippy::type_complexity)]
static SOURCES: &[(&str, &str, &[(&str, &str)])] = &[("mask", "mask.hlsl", &[])];

static PROTOS: &[&str] = &["src/proto/messages.proto"];

fn main() {
    if std::env::var("PROTOC").is_err() {
        let protoc_path = protoc_bin_vendored_win32::protoc_bin_path();
        unsafe {
            std::env::set_var("PROTOC", protoc_path);
        }
    }

    for &path in PROTOS {
        println!("cargo:rerun-if-changed={path}");
    }
    let mut prost_build = prost_build::Config::new();
    // Use Bytes for bytes fields instead of a Vec<u8>
    prost_build.bytes(["."]);
    prost_build.compile_protos(PROTOS, &["src/proto/"]).unwrap();

    let out_path = std::env::var("OUT_DIR").unwrap();
    let out_path = Path::new(&out_path);
    assert!(out_path.exists());
    let shader_dir = Path::new("src/bw_scr/shaders");
    for &(out_name, source, defines) in SOURCES.iter() {
        let source_path = shader_dir.join(source);
        println!("cargo:rerun-if-changed={}", source_path.to_str().unwrap());
        let bin_path = out_path.join(format!("{out_name}.sm5.bin"));
        let asm_path = out_path.join(format!("{out_name}.sm5.asm"));
        compile_prism_shader(
            &source_path,
            &bin_path,
            &asm_path,
            defines,
            shader_dir,
            ShaderType::Pixel,
            ShaderModel::Sm5,
        )
        .unwrap_or_else(|e| panic!("Failed to compile {out_name}: {e:?}"));

        let bin_path = out_path.join(format!("{out_name}.sm4.bin"));
        let asm_path = out_path.join(format!("{out_name}.sm4.asm"));
        compile_prism_shader(
            &source_path,
            &bin_path,
            &asm_path,
            defines,
            shader_dir,
            ShaderType::Pixel,
            ShaderModel::Sm4,
        )
        .unwrap_or_else(|e| panic!("Failed to compile {out_name}: {e:?}"));
    }
    println!(
        "cargo:rustc-env=SHIELDBATTERY_VERSION={}",
        package_json_version("../package.json")
    );
}

fn package_json_version(path: &str) -> String {
    println!("cargo:rerun-if-changed={path}");
    let mut file = fs::File::open(path).unwrap();
    let json: serde_json::Value = serde_json::from_reader(&mut file).unwrap();
    json.as_object()
        .expect("package.json root not object")
        .get("version")
        .expect("package.json version not found")
        .as_str()
        .expect("package.json version not string")
        .into()
}

fn compile_prism_shader(
    source_path: &Path,
    out_path: &Path,
    disasm_path: &Path,
    defines: &[(&str, &str)],
    include_root: &Path,
    shader_type: ShaderType,
    model: ShaderModel,
) -> Result<(), Error> {
    let text_bytes = fs::read(source_path)
        .with_context(|| format!("Failed to read {}", source_path.display()))?;
    let result = compile_shaders::compile(&text_bytes, defines, include_root, shader_type, model)?;
    for path in result.include_files {
        println!("cargo:rerun-if-changed={path}");
    }
    let shader_bytes = result.shader;
    let wrapped = compile_shaders::wrap_prism_shader(&shader_bytes);
    fs::write(out_path, wrapped)
        .with_context(|| format!("Failed to write {}", out_path.display()))?;
    disasm_shader(&shader_bytes, disasm_path).context("Failed to disassemble the result")?;
    Ok(())
}

/// Output disassembly if needed for debugging.
/// Not necessary for actually building.
fn disasm_shader(shader_bytes: &[u8], out_path: &Path) -> Result<(), Error> {
    let disasm = compile_shaders::disassemble(shader_bytes)?;
    fs::write(out_path, disasm)
        .with_context(|| format!("Failed to write {}", out_path.display()))?;
    Ok(())
}
