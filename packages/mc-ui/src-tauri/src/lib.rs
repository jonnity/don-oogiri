use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// 投影画面を別ウィンドウで開く。既に開いていればフォーカスするだけにする
/// （重複起動でプロジェクター出力が意図せず切り替わるのを防ぐ）。
/// クエリ文字列はフロント側(URLSearchParams)で組み立て済みのものをそのまま使う。
#[tauri::command]
fn open_projection_window(app: tauri::AppHandle, query: String) -> Result<(), String> {
  if let Some(existing) = app.get_webview_window("projection") {
    existing.set_focus().map_err(|e| e.to_string())?;
    return Ok(());
  }

  let url = WebviewUrl::App(format!("index.html?{query}").into());
  WebviewWindowBuilder::new(&app, "projection", url)
    .title("ドン大喜利 投影画面")
    .inner_size(1280.0, 720.0)
    .build()
    .map_err(|e| e.to_string())?;

  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![open_projection_window])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
