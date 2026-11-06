fn main() {
  // Manifesto dos comandos do app: com ele, cada comando só roda na janela cuja
  // capability o libera (capabilities/*.json). Sem isso, a página remota da
  // janela "chatgpt" não teria um controle explícito do que pode chamar.
  tauri_build::try_build(
    tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
      "read_vault",
      "scan_cursor_transcripts",
      "abrir_chatgpt",
      "salvar_conversa_chatgpt",
      "listar_conversas_chatgpt",
    ])),
  )
  .expect("falha ao rodar tauri-build");
}
