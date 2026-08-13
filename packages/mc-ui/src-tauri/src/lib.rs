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
  // 診断用: WebView2のリモートデバッグを有効化する。投影画面が固まった状態でも
  // 同じPC上の別のEdge/Chromeで http://localhost:9222 を開けば中身を検証できる。
  // 原因が特定でき次第、恒久対応に置き換えてこのオプションは外す。
  #[cfg(target_os = "windows")]
  std::env::set_var(
    "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
    "--remote-debugging-port=9222",
  );

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
