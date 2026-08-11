const DEFAULT_SERVER_PORT = "8787";

/**
 * サーバーの既定接続先を算出する。
 * `VITE_SERVER_URL` が指定されていればそれを優先するが、未指定の場合は
 * 「今このページにアクセスしているホスト名」を使う。QRコードで飛んできたスマホが
 * 会場PCのIP経由でアクセスしていても、localhost固定にせずそのまま動く。
 */
export function resolveServerUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL;
  if (configured) return configured;
  return `${window.location.protocol}//${window.location.hostname}:${DEFAULT_SERVER_PORT}`;
}
