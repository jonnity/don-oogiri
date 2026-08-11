/** QRコードのリンクは `?m=<matchId>` の形で試合を指定する（ルームコード入力なしでjoinできるように）。 */
export function getMatchIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("m");
}
