use serde::Serialize;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Nota crua devolvida ao front — o JS monta o tipo `Note` (parseCreatedAt
/// continua no lado TS para preservar o contrato existente).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultNote {
    pub path: String,
    pub name: String,
    pub content: String,
    pub mtime_ms: i64,
}

#[derive(Serialize)]
pub struct VaultReadResult {
    pub notes: Vec<VaultNote>,
    pub errors: Vec<String>,
}

/// Varre o cofre inteiro em UM round-trip IPC (o caminho antigo via plugin-fs
/// fazia 2 chamadas por nota, serializadas — proibitivo em cofres grandes).
/// `spawn_blocking`: I/O síncrono não pode rodar na thread do runtime.
#[tauri::command]
pub async fn read_vault(root: String) -> Result<VaultReadResult, String> {
    tauri::async_runtime::spawn_blocking(move || read_vault_sync(&root))
        .await
        .map_err(|e| e.to_string())?
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn read_vault_sync(root: &str) -> Result<VaultReadResult, String> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(format!("nao e um diretorio: {root}"));
    }

    let mut notes = Vec::new();
    let mut errors = Vec::new();

    for entry in walkdir::WalkDir::new(root_path).follow_links(false) {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                errors.push(e.to_string());
                continue;
            }
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        if !p
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("md"))
        {
            continue;
        }

        match std::fs::read(p) {
            // from_utf8_lossy: paridade com o TextDecoder do plugin-fs, que
            // também tolera bytes inválidos em vez de falhar.
            Ok(bytes) => {
                let content = String::from_utf8_lossy(&bytes).into_owned();
                let rel = p
                    .strip_prefix(root_path)
                    .unwrap_or(p)
                    .to_string_lossy()
                    .replace('\\', "/");
                let name = p
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned();
                let mtime_ms = entry
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or_else(now_ms);
                notes.push(VaultNote {
                    path: rel,
                    name,
                    content,
                    mtime_ms,
                });
            }
            Err(e) => errors.push(format!("{}: {e}", p.display())),
        }
    }

    Ok(VaultReadResult { notes, errors })
}
