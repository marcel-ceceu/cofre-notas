use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

/// Script injetado em toda página da janela "chatgpt" (roda antes do onload, inclusive em URL remota).
const SCRIPT: &str = include_str!("../chatgpt_export.js");

/// Pasta fixa das transcrições originais (ver docs/PASTAS-CONVERSAS.md).
/// Espelha CONVERSAS_ROOT/CHATGPT_SUBDIR de src/lib/import/dest.ts.
const CONVERSAS_ROOT: &str = r"D:\915_CofreNotas-Conversas";
const CHATGPT_SUBDIR: &str = "1_Chatgpt";

/// Limite de tamanho do nome (o exportador gera ~85 caracteres).
const NOME_MAX: usize = 200;

/// Bytes lidos do início de cada .md: basta para o cabeçalho (uuid/updated/origem).
const CABECALHO_BYTES: u64 = 4096;

/// Arquivo já exportado: nome + início do conteúdo. O exportador lê o cabeçalho
/// para reconhecer duplicata idêntica (mesmo uuid e updated) ou conversa alterada.
#[derive(Debug, Serialize)]
pub struct ConversaExistente {
  nome: String,
  cabecalho: String,
}

/// Abre (ou foca) a janela interna do ChatGPT com o exportador injetado.
#[tauri::command]
pub async fn abrir_chatgpt(app: AppHandle) -> Result<(), String> {
  if let Some(win) = app.get_webview_window("chatgpt") {
    win.set_focus().map_err(|e| e.to_string())?;
    return Ok(());
  }
  let url = Url::parse("https://chatgpt.com/").map_err(|e| e.to_string())?;
  WebviewWindowBuilder::new(&app, "chatgpt", WebviewUrl::External(url))
    .title("ChatGPT — exportar conversas")
    .inner_size(1100.0, 800.0)
    .initialization_script(SCRIPT)
    .build()
    .map_err(|e| e.to_string())?;
  Ok(())
}

/// Aceita só um nome de arquivo `.md` simples: sem pasta, sem `..`, sem caractere proibido no Windows.
/// É a única defesa entre a página remota (chatgpt.com) e o disco, por isso é estrita.
fn validar_nome(nome: &str) -> Result<&str, String> {
  let ok = !nome.is_empty()
    && nome.len() <= NOME_MAX
    && nome.to_ascii_lowercase().ends_with(".md")
    && !nome.starts_with('.')
    && !nome.contains("..")
    && !nome
      .chars()
      .any(|c| c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'));
  if ok {
    Ok(nome)
  } else {
    Err(format!("nome de arquivo recusado: {nome:?}"))
  }
}

fn pasta_chatgpt() -> PathBuf {
  PathBuf::from(CONVERSAS_ROOT).join(CHATGPT_SUBDIR)
}

/// Grava uma conversa exportada em `D:\915_CofreNotas-Conversas\1_Chatgpt\<nome>`.
/// Chamado pelo exportador injetado na janela "chatgpt" (capabilities/chatgpt.json).
/// Mesmo nome = mesma conversa na mesma versão → sobrescreve (reexportar não duplica).
#[tauri::command]
pub async fn salvar_conversa_chatgpt(nome: String, conteudo: String) -> Result<String, String> {
  let nome = validar_nome(&nome)?;
  let dir = pasta_chatgpt();
  std::fs::create_dir_all(&dir).map_err(|e| format!("não criou {}: {e}", dir.display()))?;
  let alvo = dir.join(nome);
  std::fs::write(&alvo, conteudo.as_bytes())
    .map_err(|e| format!("não gravou {}: {e}", alvo.display()))?;
  Ok(alvo.display().to_string())
}

/// Lista os .md de `1_Chatgpt` com o início de cada um. Pasta inexistente = lista vazia.
#[tauri::command]
pub async fn listar_conversas_chatgpt() -> Result<Vec<ConversaExistente>, String> {
  listar_em(&pasta_chatgpt())
}

fn listar_em(dir: &Path) -> Result<Vec<ConversaExistente>, String> {
  let entradas = match std::fs::read_dir(dir) {
    Ok(e) => e,
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
    Err(e) => return Err(format!("não leu {}: {e}", dir.display())),
  };
  let mut out = Vec::new();
  for ent in entradas.flatten() {
    let caminho = ent.path();
    let nome = ent.file_name().to_string_lossy().into_owned();
    if !caminho.is_file() || !nome.to_ascii_lowercase().ends_with(".md") {
      continue;
    }
    let mut bytes = Vec::new();
    if std::fs::File::open(&caminho)
      .and_then(|f| f.take(CABECALHO_BYTES).read_to_end(&mut bytes))
      .is_err()
    {
      continue; // ilegível: tratado como inexistente (será exportado de novo)
    }
    out.push(ConversaExistente {
      nome,
      cabecalho: String::from_utf8_lossy(&bytes).into_owned(),
    });
  }
  Ok(out)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn lista_so_md_com_inicio_do_arquivo() {
    let dir = std::env::temp_dir().join(format!("gptexport-teste-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("a.md"), format!("---\nuuid: x\n---\n{}", "y".repeat(10_000))).unwrap();
    std::fs::write(dir.join("b.txt"), "ignorado").unwrap();
    let lista = listar_em(&dir).unwrap();
    std::fs::remove_dir_all(&dir).unwrap();
    assert_eq!(lista.len(), 1);
    assert_eq!(lista[0].nome, "a.md");
    assert!(lista[0].cabecalho.starts_with("---\nuuid: x"));
    assert_eq!(lista[0].cabecalho.len(), CABECALHO_BYTES as usize);
  }

  #[test]
  fn pasta_inexistente_vira_lista_vazia() {
    let lista = listar_em(Path::new(r"Z:\nao-existe-gptexport")).unwrap();
    assert!(lista.is_empty());
  }

  #[test]
  fn aceita_nome_do_exportador() {
    assert!(validar_nome("2026-11-05_Plano-de-vendas_6a1b2c3d.md").is_ok());
  }

  #[test]
  fn recusa_caminho_e_traversal() {
    for ruim in [
      "..\\x.md",
      "../x.md",
      "C:\\x.md",
      "pasta\\x.md",
      "a/b.md",
      "x.txt",
      "",
      ".md",
      "a|b.md",
      "a\nb.md",
    ] {
      assert!(validar_nome(ruim).is_err(), "deveria recusar {ruim:?}");
    }
  }

  #[test]
  fn recusa_nome_longo_demais() {
    let longo = format!("{}.md", "a".repeat(NOME_MAX));
    assert!(validar_nome(&longo).is_err());
  }

  #[test]
  fn pasta_fica_sob_a_raiz_fixa() {
    assert_eq!(
      pasta_chatgpt(),
      PathBuf::from(r"D:\915_CofreNotas-Conversas\1_Chatgpt")
    );
  }
}
