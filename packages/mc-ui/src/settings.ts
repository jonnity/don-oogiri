const SERVER_URL_KEY = "donOogiri.serverUrl";
const AUDIENCE_BASE_URL_KEY = "donOogiri.audienceBaseUrl";
const MATCH_ID_KEY = "donOogiri.matchId";
const DEFAULT_SERVER_PORT = "8787";
const DEFAULT_AUDIENCE_PORT = "5174";

/**
 * TauriのwebviewはPhase1想定のブラウザとは`location`が異なる（`tauri://localhost`等）。
 * `location`ベースの自動推測はここでは使えないため、Tauri配下かどうかを判定して
 * 自動推測を諦め、明示的な設定値（env or 保存済み設定）だけに頼る。
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorageが使えない環境では保存できないが、そのランでは毎回設定入力を求めればよいので致命的ではない
  }
}

function removeStored(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 読み書きできない環境ではそもそも保存されていないので無視してよい
  }
}

function locationBasedDefault(port: string): string | null {
  if (typeof window === "undefined" || isTauri()) return null;
  return `${window.location.protocol}//${window.location.hostname}:${port}`;
}

/** サーバの接続先URL。未確定の場合はnullを返すので、呼び出し側は設定入力UIへ誘導すること。 */
export function resolveServerUrl(): string | null {
  const configured = import.meta.env.VITE_SERVER_URL;
  if (configured) return configured;
  const stored = readStored(SERVER_URL_KEY);
  if (stored) return stored;
  return locationBasedDefault(DEFAULT_SERVER_PORT);
}

export function setServerUrl(url: string): void {
  writeStored(SERVER_URL_KEY, url);
}

/** 観客投票ページのベースURL（`?m=<matchId>`を付与して使う）。 */
export function resolveAudienceBaseUrl(): string | null {
  const configured = import.meta.env.VITE_AUDIENCE_URL;
  if (configured) return configured;
  const stored = readStored(AUDIENCE_BASE_URL_KEY);
  if (stored) return stored;
  return locationBasedDefault(DEFAULT_AUDIENCE_PORT);
}

export function setAudienceBaseUrl(url: string): void {
  writeStored(AUDIENCE_BASE_URL_KEY, url);
}

/**
 * 進行中の試合セッション（matchId）。作成のたびに新しいQRコードを配って回るのは
 * 運用上不便なので、MCが明示的に「セッションを破棄して新規開始」を選ぶまでは
 * 同一クライアントで使い回す（「次の試合を作る」はこのmatchIdを維持したまま
 * NEW_MATCHイベントで中身だけ差し替えるので、ここはクリアしない）。
 */
export function resolveMatchId(): string | null {
  return readStored(MATCH_ID_KEY);
}

export function setStoredMatchId(matchId: string): void {
  writeStored(MATCH_ID_KEY, matchId);
}

export function clearStoredMatchId(): void {
  removeStored(MATCH_ID_KEY);
}
