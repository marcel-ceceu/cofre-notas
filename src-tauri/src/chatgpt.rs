use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

/// Script injetado em toda página da janela "chatgpt" (roda antes do onload, inclusive em URL remota).
const SCRIPT: &str = include_str!("../chatgpt_export.js");

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
