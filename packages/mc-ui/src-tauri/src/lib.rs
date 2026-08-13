use tauri::{webview::PageLoadEvent, Manager, WebviewUrl, WebviewWindowBuilder};

/// 投影画面を別ウィンドウで開く。既に開いていればフォーカスするだけにする
/// （重複起動でプロジェクター出力が意図せず切り替わるのを防ぐ）。
/// クエリ文字列はフロント側(URLSearchParams)で組み立て済みのものをそのまま使う。
///
/// Tauriのコマンドハンドラは(同期fnでも)メインスレッドではなく非同期ランタイムの
/// ワーカースレッドで実行される。WindowsのWebView2はCOMベースで初期化されており、
/// メインスレッド以外からWebviewWindowを生成すると初期化が完了しないまま
/// フリーズすることがある(ネイティブウィンドウの外枠だけ出来て中身が白いまま固まる)。
/// `run_on_main_thread`で明示的にメインスレッドへディスパッチして回避する。
#[tauri::command]
fn open_projection_window(app: tauri::AppHandle, query: String) -> Result<(), String> {
  if let Some(existing) = app.get_webview_window("projection") {
    existing.set_focus().map_err(|e| e.to_string())?;
    return Ok(());
  }

  app
    .clone()
    .run_on_main_thread(move || {
      let url = WebviewUrl::App(format!("index.html?{query}").into());
      let result = WebviewWindowBuilder::new(&app, "projection", url)
        .title("ドン大喜利 投影画面")
        .inner_size(1280.0, 720.0)
        // 診断用: 白画面フリーズ調査のためDevToolsを自動で開く。
        // 原因が特定でき次第、この呼び出しは外す。
        .on_page_load(|window, payload| {
          if payload.event() == PageLoadEvent::Started {
            window.open_devtools();
          }
        })
        .build();

      match result {
        Ok(window) => window.open_devtools(),
        Err(err) => log::error!("failed to build projection window: {err}"),
      }
    })
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
