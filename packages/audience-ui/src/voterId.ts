/**
 * 匿名の端末識別。spec: 「1端末1票（セッションCookie/localStorageで制御）」に対応。
 * 観客ページはネイティブ化しないWeb専用なので、localStorage依存でよい。
 */
const VOTER_ID_KEY = "don-oogiri:voterId";

export function getOrCreateVoterId(): string {
  const existing = localStorage.getItem(VOTER_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(VOTER_ID_KEY, id);
  return id;
}

function votedRoundStorageKey(matchId: string): string {
  return `don-oogiri:votedRound:${matchId}`;
}

/** この端末がmatchIdで最後に投票したvotingRoundId（未投票ならnull）。楽観的UI表示にのみ使う。 */
export function getLastVotedRound(matchId: string): number | null {
  const raw = localStorage.getItem(votedRoundStorageKey(matchId));
  return raw === null ? null : Number(raw);
}

export function setLastVotedRound(matchId: string, votingRoundId: number): void {
  localStorage.setItem(votedRoundStorageKey(matchId), String(votingRoundId));
}
