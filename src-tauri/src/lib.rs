mod chatgpt;
mod cursor;
mod vault;

use tauri::Manager;

/// A janela nasce VISÍVEL (tauri.conf.json: visible=true, com backgroundColor
/// igual ao fundo do app para não piscar). Em 04/11/2026, com a janela oculta,
/// o WebView2 passou a recusar o `AddScriptToExecuteOnDocumentCreated` com
/// 0x80070578 ("identificador da janela inválido") e o app ficava sem janela.
/// Este fallback continua como seguro caso a janela fique oculta por outro motivo.
const SHOW_FALLBACK_MS: u64 = 2500;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default()
    // Log registrado ANTES de qualquer janela: a criação da janela do
    // tauri.conf.json acontece antes do `.setup()`, e um erro ali só vai para o
    // `log` — sem logger ativo ele some e o app fica rodando sem janela.
    .plugin(
      tauri_plugin_log::Builder::default()
        .level(log::LevelFilter::Info)
        .build(),
    )
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_store::Builder::new().build());

  // O updater só existe no desktop (não há equivalente em Android/iOS).
  #[cfg(desktop)]
  {
    builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
  }

  builder
    .invoke_handler(tauri::generate_handler![
      vault::read_vault,
      cursor::scan_cursor_transcripts,
      chatgpt::abrir_chatgpt
    ])
    .setup(|app| {
      if let Some(win) = app.get_webview_window("main") {
        std::thread::spawn(move || {
          std::thread::sleep(std::time::Duration::from_millis(SHOW_FALLBACK_MS));
          if !win.is_visible().unwrap_or(false) {
            let _ = win.show();
          }
        });
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
