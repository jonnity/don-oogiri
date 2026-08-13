use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// 投影画面を別ウィンドウで開く。既に開いていればフォーカスするだけにする
/// （重複起動でプロジェクター出力が意図せず切り替わるのを防ぐ）。
/// クエリ文字列はフロント側(URLSearchParams)で組み立て済みのものをそのまま使う。
///
/// WindowsのWebView2はCOMベースで初期化されるため、WebviewWindowの生成は
/// メインスレッドで行う必要がある。それ自体は`run_on_main_thread`で満たせるが、
/// 同期(非async)コマンドはTauriのIPCディスパッチ上、WebView2からのメッセージ
/// 受信コールバックと同じメインスレッドのコールスタック上でそのまま実行される。
/// その状態から`run_on_main_thread`で再度メインスレッドへ処理を積んでも、
/// 呼び出し元がすでにメインスレッドにいるため実質的に再入(reentrant)呼び出しに
/// なり、WebView2コントローラの非同期初期化が完了に必要とするメッセージポンプの
/// 巻き戻しが起こらずデッドロックする(ネイティブウィンドウの外枠だけ出来て
/// 中身が白いまま固まる。 close/Alt+F4も効かなくなる)。
/// コマンドを`async fn`にすると、Tauriがtokioランタイム経由で実行するため
/// このコールスタックの再入が起こらなくなり、`run_on_main_thread`が正しく
/// 「メインスレッドの次のイベントループへポストする」形で機能するようになる。
/// (参考: https://github.com/tauri-apps/tauri/issues/4121)
#[tauri::command]
async fn open_projection_window(app: tauri::AppHandle, query: String) -> Result<(), String> {
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
        .build();

      if let Err(err) = result {
        log::error!("failed to build projection window: {err}");
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
