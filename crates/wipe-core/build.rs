//! Embute no binário as regras de boss (`encounters/**/*.yaml`) e as rotações base por spec
//! (`rotations/*.yaml`).

use std::fs;
use std::path::{Path, PathBuf};

fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            collect(&p, out);
        } else if p.extension().is_some_and(|x| x == "yaml" || x == "yml") {
            out.push(p);
        }
    }
}

/// `pub static <name>: &[(&str, &str)]` com (caminho relativo, conteúdo) de cada YAML da pasta.
fn embed(folder: &str, name: &str, file: &str) {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(folder);
    println!("cargo:rerun-if-changed={}", root.display());

    let mut files = Vec::new();
    collect(&root, &mut files);
    files.sort();

    let mut code = format!("pub static {name}: &[(&str, &str)] = &[\n");
    for f in &files {
        println!("cargo:rerun-if-changed={}", f.display());
        let rel = f.strip_prefix(&root).unwrap().to_string_lossy().replace('\\', "/");
        let abs = f.canonicalize().unwrap();
        code.push_str(&format!("    ({rel:?}, include_str!({:?})),\n", abs.display().to_string()));
    }
    code.push_str("];\n");

    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join(file);
    fs::write(out, code).unwrap();
}

fn main() {
    embed("encounters", "EMBEDDED", "encounters.rs");
    embed("rotations", "EMBEDDED_ROTATIONS", "rotations.rs");
}
