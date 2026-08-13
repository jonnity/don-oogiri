import type { TeamId } from "@don-oogiri/engine";

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

interface VotedRecord {
  round: number;
  team: TeamId;
}

function votedRecordStorageKey(matchId: string): string {
  return `don-oogiri:votedRecord:${matchId}`;
}

/** この端末がvotingRoundIdで最後に投票したチーム（未投票/別ラウンドならnull）。楽観的UI表示・再選択の初期値表示に使う。 */
export function getLastVotedTeam(matchId: string, votingRoundId: number): TeamId | null {
  const raw = localStorage.getItem(votedRecordStorageKey(matchId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as VotedRecord;
    return parsed.round === votingRoundId ? parsed.team : null;
  } catch {
    return null;
  }
}

export function setLastVotedTeam(matchId: string, votingRoundId: number, team: TeamId): void {
  const record: VotedRecord = { round: votingRoundId, team };
  localStorage.setItem(votedRecordStorageKey(matchId), JSON.stringify(record));
}
