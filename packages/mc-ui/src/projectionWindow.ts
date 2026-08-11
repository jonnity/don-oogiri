import { isTauri } from "./settings.js";

interface OpenProjectionParams {
  matchId: string;
  serverUrl: string;
  audienceBaseUrl: string;
}

function buildProjectionQuery({ matchId, serverUrl, audienceBaseUrl }: OpenProjectionParams): string {
  return new URLSearchParams({
    view: "projection",
    m: matchId,
    serverUrl,
    audienceBaseUrl,
  }).toString();
}

/**
 * 投影画面を別ウィンドウで開く。
 * Tauri配下ではRust側の`open_projection_window`コマンドにウィンドウ生成を任せる
 * （すでに開いていればフォーカスするだけにして、プロジェクター出力の意図しない
 * 切り替えを防ぐロジックもRust側に集約する）。通常のブラウザではただの別タブ/
 * 別ウィンドウで代用する。
 */
export async function openProjectionWindow(params: OpenProjectionParams): Promise<void> {
  const query = buildProjectionQuery(params);

  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_projection_window", { query });
    return;
  }

  const url = `${window.location.origin}${window.location.pathname}?${query}`;
  window.open(url, "don-oogiri-projection", "noopener");
}
