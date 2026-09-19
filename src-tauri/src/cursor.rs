use serde::Serialize;
use std::path::Path;
use std::time::UNIX_EPOCH;
use walkdir::{DirEntry, WalkDir};

/// Metadados de um transcript do Cursor, suficientes para a tela de seleção.
/// O conteúdo completo NÃO vem aqui — o front lê só os arquivos escolhidos.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorTranscript {
    /// caminho absoluto do .jsonl
    pub path: String,
    /// primeira pasta abaixo da raiz (`.cursor/projects/<projeto>/...`)
    pub project: String,
    /// stem do arquivo (== nome da pasta pai)
    pub uuid: String,
    pub size_bytes: u64,
    pub mtime_ms: i64,
    pub ctime_ms: Option<i64>,
    /// linhas `user` com <user_query> (turnos reais do usuário)
    pub user_turns: u32,
    /// miolo do primeiro <user_query>, truncado — base do título
    pub first_user_query: String,
    /// texto cru do primeiro <timestamp>
    pub first_timestamp_raw: String,
}

#[derive(Serialize)]
pub struct CursorScanResult {
    pub items: Vec<CursorTranscript>,
    pub errors: Vec<String>,
}

const QUERY_PREVIEW_CHARS: usize = 160;
const USER_LINE_PREFIX: &str = "{\"role\":\"user\"";

/// Varre `~/.cursor/projects` em UM round-trip IPC (~900 arquivos hoje).
/// Layout esperado: `<root>/<projeto>/agent-transcripts/<uuid>/<uuid>.jsonl`.
/// Subagentes (`.../<uuid>/subagents/*.jsonl`) ficam de fora pela profundidade
/// máxima e pelo filtro de nome.
#[tauri::command]
pub async fn scan_cursor_transcripts(root: String) -> Result<CursorScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || scan_sync(&root))
        .await
        .map_err(|e| e.to_string())?
}

/// Profundidades: 0 raiz · 1 projeto · 2 agent-transcripts · 3 <uuid> · 4 arquivo.
fn keep_entry(e: &DirEntry) -> bool {
    let name = e.file_name().to_string_lossy();
    match e.depth() {
        2 => e.file_type().is_dir() && name == "agent-transcripts",
        4 => e.file_type().is_file(),
        _ => !name.eq_ignore_ascii_case("subagents"),
    }
}

fn ms_since_epoch(t: std::io::Result<std::time::SystemTime>) -> Option<i64> {
    t.ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
}

fn scan_sync(root: &str) -> Result<CursorScanResult, String> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(format!("nao e um diretorio: {root}"));
    }

    let mut items = Vec::new();
    let mut errors = Vec::new();

    let walker = WalkDir::new(root_path)
        .follow_links(false)
        .max_depth(4)
        .into_iter()
        .filter_entry(keep_entry);

    for entry in walker {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                errors.push(e.to_string());
                continue;
            }
        };
        if entry.depth() != 4 || !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        if !p
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("jsonl"))
        {
            continue;
        }
        let stem = p
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let parent_name = p
            .parent()
            .and_then(|d| d.file_name())
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if stem != parent_name {
            continue; // não é o transcript principal da conversa
        }
        if p.components()
            .any(|c| c.as_os_str().eq_ignore_ascii_case("subagents"))
        {
            continue;
        }

        let project = p
            .strip_prefix(root_path)
            .ok()
            .and_then(|rel| rel.components().next())
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .unwrap_or_default();

        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(e) => {
                errors.push(format!("{}: {e}", p.display()));
                continue;
            }
        };

        // from_utf8_lossy: bytes inválidos não podem abortar o inventário.
        let text = match std::fs::read(p) {
            Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
            Err(e) => {
                errors.push(format!("{}: {e}", p.display()));
                continue;
            }
        };

        let (user_turns, first_user_query, first_timestamp_raw) = summarize(&text);

        items.push(CursorTranscript {
            path: p.to_string_lossy().into_owned(),
            project,
            uuid: stem,
            size_bytes: meta.len(),
            mtime_ms: ms_since_epoch(meta.modified()).unwrap_or(0),
            ctime_ms: ms_since_epoch(meta.created()),
            user_turns,
            first_user_query,
            first_timestamp_raw,
        });
    }

    Ok(CursorScanResult { items, errors })
}

/// Conta os turnos do usuário por prefixo (barato) e parseia com serde_json
/// apenas a primeira linha `user` que tenha <user_query>.
fn summarize(text: &str) -> (u32, String, String) {
    let mut user_turns = 0u32;
    let mut first_query = String::new();
    let mut first_ts = String::new();

    for line in text.lines() {
        if !line.starts_with(USER_LINE_PREFIX) || !line.contains("<user_query>") {
            continue;
        }
        user_turns += 1;
        if !first_query.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let joined = text_blocks(&v);
        first_query = query_preview(&joined);
        first_ts = between(&joined, "<timestamp>", "</timestamp>")
            .unwrap_or("")
            .trim()
            .to_string();
    }

    (user_turns, first_query, first_ts)
}

/// Junta os blocos `text` de `message.content` (descarta tool_use).
fn text_blocks(v: &serde_json::Value) -> String {
    let content = &v["message"]["content"];
    if let Some(s) = content.as_str() {
        return s.to_string();
    }
    let Some(arr) = content.as_array() else {
        return String::new();
    };
    arr.iter()
        .filter(|b| b["type"].as_str() == Some("text"))
        .filter_map(|b| b["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn between<'a>(s: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let start = s.find(open)? + open.len();
    let end = s[start..].find(close)? + start;
    Some(&s[start..end])
}

/// Miolo do <user_query>, sem bloco de imagens, truncado em chars (não bytes).
fn query_preview(joined: &str) -> String {
    let inner = between(joined, "<user_query>", "</user_query>").unwrap_or("");
    let mut cleaned = String::with_capacity(inner.len());
    let mut rest = inner;
    while let Some(i) = rest.find("<image_files>") {
        cleaned.push_str(&rest[..i]);
        cleaned.push_str("[imagem anexada]");
        match rest[i..].find("</image_files>") {
            Some(j) => rest = &rest[i + j + "</image_files>".len()..],
            None => {
                rest = "";
                break;
            }
        }
    }
    cleaned.push_str(rest);
    cleaned.trim().chars().take(QUERY_PREVIEW_CHARS).collect()
}
