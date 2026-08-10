/**
 * サーバ(DO)とクライアント(MC操作卓/観客ページ)間で共有するメッセージ形状。
 * WebSocketの配線に依存しない純粋な型定義のみを置く。
 */
import type { CreateTeamInput } from "./engine.js";
import type { MatchConfig, MatchEvent, MatchState } from "./types.js";

export interface CreateMatchRequest {
  config: MatchConfig;
  red: CreateTeamInput;
  blue: CreateTeamInput;
}

export interface CreateMatchResponse {
  matchId: string;
}

/** サーバ→クライアント。stateは常にスナップショット全体。serverTimeはクライアントのクロックオフセット計算用。 */
export type ServerMessage =
  | { type: "state"; state: MatchState; serverTime: number }
  | { type: "error"; message: string };

/** クライアント→サーバ。 */
export type ClientMessage = { type: "event"; event: MatchEvent };
