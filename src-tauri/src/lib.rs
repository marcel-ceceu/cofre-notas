mod cursor;
mod vault;

use tauri::Manager;

/// A janela nasce oculta (tauri.conf.json: visible=false) e o front a mostra
/// após o primeiro paint. Se o JS não conseguir (ACL sem `window:allow-show`,
/// erro no bundle...), este fallback garante que ela apareça — na 0.11.0 o app
/// abria invisível por isso.
const SHOW_FALLBACK_MS: u64 = 2500;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default()
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
      cursor::scan_cursor_transcripts
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
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
