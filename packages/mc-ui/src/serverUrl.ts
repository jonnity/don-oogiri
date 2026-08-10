const DEFAULT_SERVER_PORT = "8787";

/**
 * サーバーの既定接続先を算出する。
 * `VITE_SERVER_URL` が指定されていればそれを優先するが、未指定の場合は
 * 「今このページにアクセスしているホスト名」を使う。これにより、
 * WSL2のWindows転送越しアクセスや、将来スマホが会場PCへ同一Wi-Fi経由で
 * アクセスするケース(Phase2)でも、localhost固定に縛られず動作する。
 */
export function resolveServerUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL;
  if (configured) return configured;
  return `${window.location.protocol}//${window.location.hostname}:${DEFAULT_SERVER_PORT}`;
}
