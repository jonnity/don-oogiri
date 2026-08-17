import {
  IllegalTransitionError,
  type CreateTeamInput,
  type MatchConfig,
  type MatchEvent,
  type MatchState,
  type TeamId,
  type TeamRoster,
} from "./types.js";

const MIN_TEAM_SIZE = 1;
const MAX_TEAM_SIZE = 3;

const OTHER_TEAM: Record<TeamId, TeamId> = { red: "blue", blue: "red" };

function otherTeam(team: TeamId): TeamId {
  return OTHER_TEAM[team];
}

/** 進んでる側から見た前進方向。redは陣地端0→laneLength方向(+1)、blueはlaneLength→0方向(-1)。 */
function directionFor(advancingTeam: TeamId): 1 | -1 {
  return advancingTeam === "red" ? 1 : -1;
}

/** speedMultiplierはconfig.centerToEdgeMsを変更せずに前進速度を調整するための倍率（ライブ調整・リハーサル早送り用）。 */
function advanceSpeed(config: MatchConfig, speedMultiplier: number): number {
  // 中央(laneLength/2)から端まで centerToEdgeMs かかる = 距離/時間
  return (config.laneLength / 2 / config.centerToEdgeMs) * speedMultiplier;
}

export function createMatch(
  config: MatchConfig,
  red: CreateTeamInput,
  blue: CreateTeamInput,
  topic: string,
): MatchState {
  if (config.laneLength <= 0 || config.centerToEdgeMs <= 0) {
    throw new IllegalTransitionError(
      "laneLength and centerToEdgeMs must be positive",
    );
  }
  if (config.matchTimeLimitMs !== null && config.matchTimeLimitMs <= 0) {
    throw new IllegalTransitionError(
      "matchTimeLimitMs must be positive or null",
    );
  }
  for (const team of [red, blue]) {
    if (team.members.length < MIN_TEAM_SIZE || team.members.length > MAX_TEAM_SIZE) {
      throw new IllegalTransitionError(
        `team members must be between ${MIN_TEAM_SIZE} and ${MAX_TEAM_SIZE}, got ${team.members.length}`,
      );
    }
  }
  return {
    phase: "setup",
    config,
    teams: {
      red: { name: red.name, members: red.members, nextRunnerIndex: 0 },
      blue: { name: blue.name, members: blue.members, nextRunnerIndex: 0 },
    },
    movement: { status: "idle" },
    advancingTeam: null,
    defendingTeam: null,
    bothWritingFirstDone: false,
    winner: null,
    matchEndReason: null,
    matchStartTime: null,
    timeLimitElapsedMs: 0,
    currentAnswerer: { red: null, blue: null },
    audienceVotes: { red: 0, blue: 0 },
    votingRoundId: 0,
    topic,
    qrVisible: true,
    speedMultiplier: 1,
  };
}

/** マーカーの現在位置を計算する（クライアント側の補間描画と同じロジック）。 */
export function getMarkerPosition(state: MatchState, now: number): number {
  const { movement, config } = state;
  if (movement.status === "idle") {
    return config.laneLength / 2;
  }
  if (movement.status === "frozen") {
    return movement.position;
  }
  const speed = advanceSpeed(config, state.speedMultiplier);
  const elapsed = Math.max(0, now - movement.startTime);
  const raw = movement.startPosition + movement.direction * speed * elapsed;
  return clamp(raw, 0, config.laneLength);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** advancing中のマーカーが端に到達する予定時刻。advancing中でなければnull。 */
export function nextArrivalTime(state: MatchState): number | null {
  const { movement, config } = state;
  if (movement.status !== "advancing") return null;
  const speed = advanceSpeed(config, state.speedMultiplier);
  const distanceToEdge =
    movement.direction === 1
      ? config.laneLength - movement.startPosition
      : movement.startPosition;
  const timeToArrive = Math.max(0, distanceToEdge) / speed;
  return movement.startTime + timeToArrive;
}

/** advancing中のマーカーが現在時刻nowまでに端へ到達していれば即finishedにする。 */
export function checkArrival(state: MatchState, now: number): MatchState {
  if (state.phase === "finished") return state;
  if (state.movement.status !== "advancing") return state;
  const position = getMarkerPosition(state, now);
  if (position <= 0 || position >= state.config.laneLength) {
    return {
      ...state,
      phase: "finished",
      winner: state.advancingTeam,
      matchEndReason: "arrival",
      movement: { status: "frozen", position },
    };
  }
  return state;
}

/**
 * 試合全体の制限時間の残り(ms)。制限時間なしならnull。marker が advancing だった実時間のみを
 * 消費するため（回答中/投票中の時間稼ぎは圧迫しない）、advancing中はnowにつれて減っていき、
 * それ以外（idle/frozen、あるいは未開始）は静的な値を返す。0未満にはならない。
 */
export function matchTimeLimitRemainingMs(state: MatchState, now: number): number | null {
  const limit = state.config.matchTimeLimitMs;
  if (limit === null) return null;
  const liveSegment =
    state.movement.status === "advancing"
      ? Math.max(0, now - state.movement.startTime)
      : 0;
  return Math.max(0, limit - state.timeLimitElapsedMs - liveSegment);
}

/**
 * advancingから非advancingへ遷移する（＝進行が止まる）直前に呼び、その区間の経過時間を
 * timeLimitElapsedMsへ畳み込む。advancing中でなければ何もしない。呼び出し側は、
 * startTimeを書き換える（rebaseする）場合も含め、advancingの「区間」が終わる/切り替わる
 * すべての箇所でこれを通すこと。通さないと、rebase前の区間の消費分が silently 消える
 * （＝制限時間が水増しされる）。
 */
function foldAdvancingTime(state: MatchState, now: number): number {
  if (state.movement.status !== "advancing") return state.timeLimitElapsedMs;
  return state.timeLimitElapsedMs + Math.max(0, now - state.movement.startTime);
}

/**
 * 到達判定のみを行うエントリポイント。「前進中いつでも、マーカーが相手陣地の端に到達した
 * 瞬間に確定（投票を待たない）」を、遅延実行（DOアラームの遅延等）があっても正しく
 * 再現するために使う。制限時間の満了判定はここでは行わない
 * （VOTE_RESULT解決後にmaybeFinishByTimeLimitで行う。理由はその関数のコメントを参照）。
 */
export function checkTimers(state: MatchState, now: number): MatchState {
  return checkArrival(state, now);
}

/**
 * サーバがアラームを仕込むべき次の時刻（マーカーの到達予定時刻）。advancing中でない、
 * またはfinished後はnull。制限時間の満了はアラーム駆動では判定しない
 * （maybeFinishByTimeLimit参照）ため、ここでは考慮しない。
 */
export function nextWakeTime(state: MatchState): number | null {
  if (state.phase === "finished") return null;
  return nextArrivalTime(state);
}

/**
 * VOTE_RESULT解決後の状態に対して、制限時間の消化状況を見て試合を終了させるかどうかを判定する。
 * 「回答中/投票中は時間を消費しない」設計にした結果、制限時間の満了はもはや壁時計上の
 * 一瞬のイベントではなく「advancingの累積消費時間がしきい値を超えたかどうか」という
 * 連続的な状態になった。これを厳密に「満了した瞬間」に検出しようとすると、advancing中に
 * 継続的なアラーム監視が必要になり複雑になる。代わりに、判定はVOTE_RESULT解決という
 * 離散的なチェックポイントでのみ行う：
 *   - 消化済みなら（残り<=0）、その時点のレーン占有量で「今のadvancingTeamが実際に優勢か」を見る
 *     - 優勢が確定している（占有量の優勢側 === advancingTeam、またはadvancingTeamがいない
 *       ＝tie_writing直後で誰も押していない）なら、今ここで確定させる
 *     - まだ逆転の途上（advancingTeamが劣勢側から押し返している最中）なら確定させず、
 *       次の回（阻止する側の次の指名→投票）まで継続する。これが「ラスト1答を許し、
 *       逆転するか阻止する側が同票以上で止めるまで続く」の実装：阻止する側のNOMINATEは
 *       消化状況に関わらず常に受理され（この関数はNOMINATE自体には一切関与しない）、
 *       その投票が解決した時点で改めてここに来る
 * 到達（checkArrival）は本関数と無関係に常に即座に勝敗を確定させる（spec通り、制限時間を待たない）。
 */
function maybeFinishByTimeLimit(state: MatchState, now: number): MatchState {
  if (state.phase === "finished") return state;
  const remaining = matchTimeLimitRemainingMs(state, now);
  if (remaining === null || remaining > 0) return state;

  const position = getMarkerPosition(state, now);
  const center = state.config.laneLength / 2;
  const leader: TeamId | null = position > center ? "red" : position < center ? "blue" : null;

  if (state.movement.status === "advancing" && leader !== null && leader !== state.advancingTeam) {
    // まだ逆転の途上：確定させず、次の指名・投票で改めて判定する
    return state;
  }

  const winner = leader ?? state.advancingTeam;
  return {
    ...state,
    phase: "finished",
    winner,
    matchEndReason: "time_limit",
    movement: state.movement.status === "advancing" ? { status: "frozen", position } : state.movement,
  };
}

function startAdvancing(
  state: MatchState,
  advancingTeam: TeamId,
  startPosition: number,
  now: number,
): MatchState {
  const next: MatchState = {
    ...state,
    advancingTeam,
    defendingTeam: otherTeam(advancingTeam),
    movement: {
      status: "advancing",
      startPosition,
      startTime: now,
      direction: directionFor(advancingTeam),
    },
  };
  return checkArrival(next, now);
}

function applyStartMatch(state: MatchState, now: number): MatchState {
  if (state.phase !== "setup") {
    throw new IllegalTransitionError(
      `START_MATCH is only valid in 'setup', got '${state.phase}'`,
    );
  }
  return { ...state, phase: "initial_writing", matchStartTime: now };
}

function applyFirstDone(
  state: MatchState,
  team: TeamId,
  now: number,
): MatchState {
  const inBothWritingPhase =
    state.phase === "initial_writing" || state.phase === "tie_writing";
  if (!inBothWritingPhase) {
    throw new IllegalTransitionError(
      `FIRST_DONE is only valid in 'initial_writing'/'tie_writing', got '${state.phase}'`,
    );
  }
  if (state.bothWritingFirstDone) {
    throw new IllegalTransitionError(
      "FIRST_DONE was already recorded for this writing round",
    );
  }
  // startPositionはgetMarkerPositionで決まる: 試合開始直後(idle)なら中央、
  // tie_writing(frozen)なら同数になった時点のマーカー位置から書き直しが始まる。
  const startPosition = getMarkerPosition(state, now);
  const withFlag: MatchState = {
    ...state,
    bothWritingFirstDone: true,
    currentAnswerer: {
      ...state.currentAnswerer,
      [team]: currentRunnerName(state.teams[team]),
    },
  };
  return startAdvancing(withFlag, team, startPosition, now);
}

/**
 * 阻止する側の前進停止と投票開始は同一アクション。回答完了を別クリックで待つ
 * ワンクッションは運用上不要（生大喜利では指名の瞬間に回答が出そろっている）と判断し、
 * 旧NOMINATE(前進停止のみ)と旧ANSWER_DONE(投票開始)を1つのイベントに統合した。
 */
function applyNominate(state: MatchState, now: number): MatchState {
  const inWritingPhase =
    state.phase === "initial_writing" ||
    state.phase === "tie_writing" ||
    state.phase === "challenge_writing";
  if (!inWritingPhase || state.movement.status !== "advancing") {
    throw new IllegalTransitionError(
      `NOMINATE requires an advancing marker in initial_writing/tie_writing/challenge_writing, got phase='${state.phase}' movement='${state.movement.status}'`,
    );
  }
  const position = getMarkerPosition(state, now);
  // NOMINATE可能な時点(movement.status==="advancing")ではstartAdvancing済みのため、
  // defendingTeamは常にセットされている。
  const writer = state.defendingTeam;
  // 制限時間の消化状況に関わらずNOMINATEは常に受理する（ラスト1答を許す）。
  // ここでadvancingが終わるため、この区間の消費分を畳み込んでおく。
  return {
    ...state,
    phase: "voting",
    movement: { status: "frozen", position },
    timeLimitElapsedMs: foldAdvancingTime(state, now),
    audienceVotes: { red: 0, blue: 0 },
    votingRoundId: state.votingRoundId + 1,
    currentAnswerer: writer
      ? { ...state.currentAnswerer, [writer]: currentRunnerName(state.teams[writer]) }
      : state.currentAnswerer,
  };
}

/**
 * previousTeamが指定された場合（同一投票ラウンド内での再選択）は、旧選択を取り消してから新選択を加える。
 * previousTeamとteamが同じ場合は変更なしのため何もしない。
 */
function applyAudienceVoteCast(
  state: MatchState,
  team: TeamId,
  previousTeam: TeamId | undefined,
): MatchState {
  if (state.phase !== "voting") {
    throw new IllegalTransitionError(
      `AUDIENCE_VOTE_CAST is only valid in 'voting', got '${state.phase}'`,
    );
  }
  if (previousTeam === team) return state;
  const withoutPrevious = previousTeam
    ? {
        ...state.audienceVotes,
        [previousTeam]: Math.max(0, state.audienceVotes[previousTeam] - 1),
      }
    : state.audienceVotes;
  return {
    ...state,
    audienceVotes: {
      ...withoutPrevious,
      [team]: withoutPrevious[team] + 1,
    },
  };
}

function applyCloseVoting(state: MatchState, now: number): MatchState {
  if (state.phase !== "voting") {
    throw new IllegalTransitionError(
      `CLOSE_VOTING is only valid in 'voting', got '${state.phase}'`,
    );
  }
  return applyVoteResult(
    state,
    state.audienceVotes.red,
    state.audienceVotes.blue,
    now,
  );
}

function incrementRunner(state: MatchState, team: TeamId): MatchState {
  const roster = state.teams[team];
  const nextRunnerIndex = (roster.nextRunnerIndex + 1) % roster.members.length;
  return {
    ...state,
    teams: {
      ...state.teams,
      [team]: { ...roster, nextRunnerIndex },
    },
  };
}

function applyVoteResult(
  state: MatchState,
  redVotes: number,
  blueVotes: number,
  now: number,
): MatchState {
  if (state.phase !== "voting") {
    throw new IllegalTransitionError(
      `VOTE_RESULT is only valid in 'voting', got '${state.phase}'`,
    );
  }
  if (redVotes < 0 || blueVotes < 0) {
    throw new IllegalTransitionError("vote counts must be non-negative");
  }
  const advancingTeam = state.advancingTeam;
  const defendingTeam = state.defendingTeam;
  if (!advancingTeam || !defendingTeam) {
    throw new IllegalTransitionError(
      "VOTE_RESULT requires advancingTeam and defendingTeam to be set",
    );
  }
  const advancingVotes = advancingTeam === "red" ? redVotes : blueVotes;
  const defendingVotes = defendingTeam === "red" ? redVotes : blueVotes;
  // 同数票は進んでる側の勝ち（阻止する側は上回る必要がある）
  const defendingWins = defendingVotes > advancingVotes;
  const isTie = advancingVotes === defendingVotes;
  const frozenPosition =
    state.movement.status === "frozen"
      ? state.movement.position
      : getMarkerPosition(state, now);

  if (isTie) {
    // 同数票 = 防衛成功（反転はしない）。ただし同じ顔合わせが続かないよう両チームとも
    // 次走者に交代し、initial_writingと同じ「両チーム同時執筆」の形でゼロから書き直す。
    // マーカーは同数になった時点の位置のまま(frozen)で止まっており、次のFIRST_DONEで
    // その位置から改めて前進が始まる。
    const withBothRotated = incrementRunner(
      incrementRunner(state, defendingTeam),
      advancingTeam,
    );
    const tieResult: MatchState = {
      ...withBothRotated,
      phase: "tie_writing",
      advancingTeam: null,
      defendingTeam: null,
      bothWritingFirstDone: false,
      movement: { status: "frozen", position: frozenPosition },
    };
    // 押している側がいない(=誰も優劣を争っていない)ので、制限時間消化済みなら逆転の余地なく即確定する。
    return maybeFinishByTimeLimit(tieResult, now);
  }

  if (!defendingWins) {
    // 進んでる側の勝ち: そのままchallenge_writing継続。負けた阻止側の次走者が執筆。
    const withNextRunner = incrementRunner(state, defendingTeam);
    const resumed = startAdvancing(
      withNextRunner,
      advancingTeam,
      frozenPosition,
      now,
    );
    return maybeFinishByTimeLimit({ ...resumed, phase: "challenge_writing" }, now);
  }

  // 阻止する側の勝ち（反転）: この位置から反転。負けた側(旧advancing)の次走者が新defenderとして執筆。
  const withNextRunner = incrementRunner(state, advancingTeam);
  const reversed = startAdvancing(
    withNextRunner,
    defendingTeam,
    frozenPosition,
    now,
  );
  return maybeFinishByTimeLimit({ ...reversed, phase: "challenge_writing" }, now);
}

/** お題の訂正（誤字修正など）。spec通り「1試合1お題固定」なのでゲーム進行上の変更ではなく、あくまで表記の訂正用途。 */
function applySetTopic(state: MatchState, topic: string): MatchState {
  const trimmed = topic.trim();
  if (!trimmed) {
    throw new IllegalTransitionError("topic must not be empty");
  }
  return { ...state, topic: trimmed };
}

/** 投影画面のQRコード表示切り替え。常時表示ではなくMCが必要なタイミングだけ表示する運用のための操作。 */
function applySetQrVisible(state: MatchState, visible: boolean): MatchState {
  return { ...state, qrVisible: visible };
}

/**
 * 前進速度のライブ調整・リハーサル早送り用。config.centerToEdgeMsは変更しない。
 * advancing中に倍率を変えると速度の分母が変わるため、現在位置を基準に startPosition/startTime を
 * 引き継ぎ直す（そうしないと巻き戻り/急なジャンプが起きる）。frozen/idle中は位置が速度に依存しないため
 * 倍率を差し替えるだけでよい。
 */
function applySetSpeedMultiplier(
  state: MatchState,
  multiplier: number,
  now: number,
): MatchState {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new IllegalTransitionError("speed multiplier must be a positive number");
  }
  if (state.movement.status !== "advancing") {
    return { ...state, speedMultiplier: multiplier };
  }
  const currentPosition = getMarkerPosition(state, now);
  // startTimeをnowへrebaseする前に、この区間の消費分を畳み込んでおく
  // （畳み込まないと、rebaseのたびに消費済み時間が水増しでリセットされてしまう）。
  const rebased: MatchState = {
    ...state,
    speedMultiplier: multiplier,
    timeLimitElapsedMs: foldAdvancingTime(state, now),
    movement: {
      status: "advancing",
      startPosition: currentPosition,
      startTime: now,
      direction: state.movement.direction,
    },
  };
  return checkArrival(rebased, now);
}

/**
 * マーカー位置の手動補正（トラブルリカバリ）。誤操作/回線トラブル等で位置がずれた場合に使う。
 * idle中は位置が常に中央固定でありそもそも補正の余地がないため対象外。
 * advancing中の補正で端(0/laneLength)を指定した場合はcheckArrivalによりその場で試合が確定する
 * （＝MCが「もう到達したとみなす」ための明示的なショートカットとして機能する。意図的な仕様）。
 */
function applyCorrectMarkerPosition(
  state: MatchState,
  position: number,
  now: number,
): MatchState {
  const correctablePhase =
    state.phase === "initial_writing" ||
    state.phase === "tie_writing" ||
    state.phase === "challenge_writing" ||
    state.phase === "voting";
  if (!correctablePhase || state.movement.status === "idle") {
    throw new IllegalTransitionError(
      `CORRECT_MARKER_POSITION requires an active marker (advancing/frozen) in initial_writing/tie_writing/challenge_writing/voting, got phase='${state.phase}' movement='${state.movement.status}'`,
    );
  }
  if (!Number.isFinite(position)) {
    throw new IllegalTransitionError("position must be a finite number");
  }
  const clamped = clamp(position, 0, state.config.laneLength);
  if (state.movement.status === "frozen") {
    return { ...state, movement: { status: "frozen", position: clamped } };
  }
  // startTimeをnowへrebaseする前に、この区間の消費分を畳み込んでおく（理由はSET_SPEED_MULTIPLIER側と同様）。
  const rebased: MatchState = {
    ...state,
    timeLimitElapsedMs: foldAdvancingTime(state, now),
    movement: {
      status: "advancing",
      startPosition: clamped,
      startTime: now,
      direction: state.movement.direction,
    },
  };
  return checkArrival(rebased, now);
}

/**
 * 試合リセット（トラブルリカバリ）。チーム名/メンバー/お題/パラメータはそのままに、
 * 進行状態だけをsetup直後の状態へ戻す。メンバー登録のやり直しを避けるための機能。
 * votingRoundIdはリセットしない: DO側の投票dedup(voterId -> 最後に投票したround)はメモリ上に残るため、
 * ここを0に戻すと直前のラウンドで投票済みの観客が「まだ投票していない」と誤認識されて二重投票が発生しうる。
 */
function applyResetMatch(state: MatchState): MatchState {
  return {
    ...state,
    phase: "setup",
    teams: {
      red: { ...state.teams.red, nextRunnerIndex: 0 },
      blue: { ...state.teams.blue, nextRunnerIndex: 0 },
    },
    movement: { status: "idle" },
    advancingTeam: null,
    defendingTeam: null,
    bothWritingFirstDone: false,
    winner: null,
    matchEndReason: null,
    matchStartTime: null,
    timeLimitElapsedMs: 0,
    currentAnswerer: { red: null, blue: null },
    audienceVotes: { red: 0, blue: 0 },
  };
}

/**
 * 同一セッション(matchId/DOルーム)を維持したまま、新しいチーム・お題で次の試合を始める。
 * createMatchと違いvotingRoundIdは引き継ぐ（0に戻さない）: RESET_MATCHと同じ理由で、
 * DO側の投票dedupや観客のlocalStorage記録が直前の試合のラウンド番号を覚えているため、
 * 0から採番し直すと番号が衝突し、次の試合の投票が「投票済み」と誤認識されてしまう。
 */
function applyNewMatch(
  state: MatchState,
  event: { config: MatchConfig; red: CreateTeamInput; blue: CreateTeamInput; topic: string },
): MatchState {
  const fresh = createMatch(event.config, event.red, event.blue, event.topic);
  return { ...fresh, votingRoundId: state.votingRoundId };
}

/** 状態機械の唯一のエントリポイント。不正な遷移は IllegalTransitionError を投げる。 */
export function transition(
  state: MatchState,
  event: MatchEvent,
  now: number,
): MatchState {
  // 前進中の端到達・制限時間満了は最優先: 「前進中いつでも、マーカーが相手陣地の端に到達した瞬間に確定
  // （投票を待たない）」「制限時間満了時点でも同様」。これらでfinishedになった場合は、
  // 元のイベントより確定を優先して即返す。
  const current = checkTimers(state, now);
  if (current.phase === "finished" && state.phase !== "finished") {
    return current;
  }
  switch (event.type) {
    case "START_MATCH":
      return applyStartMatch(current, now);
    case "FIRST_DONE":
      return applyFirstDone(current, event.team, now);
    case "NOMINATE":
      return applyNominate(current, now);
    case "VOTE_RESULT":
      return applyVoteResult(current, event.redVotes, event.blueVotes, now);
    case "AUDIENCE_VOTE_CAST":
      return applyAudienceVoteCast(current, event.team, event.previousTeam);
    case "CLOSE_VOTING":
      return applyCloseVoting(current, now);
    case "SET_TOPIC":
      return applySetTopic(current, event.topic);
    case "SET_QR_VISIBLE":
      return applySetQrVisible(current, event.visible);
    case "SET_SPEED_MULTIPLIER":
      return applySetSpeedMultiplier(current, event.multiplier, now);
    case "CORRECT_MARKER_POSITION":
      return applyCorrectMarkerPosition(current, event.position, now);
    case "RESET_MATCH":
      return applyResetMatch(current);
    case "NEW_MATCH":
      return applyNewMatch(current, event);
    default: {
      const _exhaustive: never = event;
      throw new IllegalTransitionError(
        `Unknown event: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

/**
 * 現在のnextRunnerIndexが指す走者名。nextRunnerIndexはincrementRunnerで常に
 * members.lengthの範囲内に保たれるため、未定義になることはない。
 */
function currentRunnerName(roster: TeamRoster): string {
  const name = roster.members[roster.nextRunnerIndex];
  if (name === undefined) {
    throw new IllegalTransitionError(
      `nextRunnerIndex ${roster.nextRunnerIndex} is out of range for ${roster.members.length} members`,
    );
  }
  return name;
}

/**
 * 次に執筆すべき人（表示用、単一）。initial_writing/tie_writingで両チームがまだ
 * 同時執筆中（どちらも書き終えていない）の場合は1人に特定できないためnull
 * （その場合はcurrentWritersで両チーム分を取得する）。該当者がいなければnull。
 */
export function currentWriter(
  state: MatchState,
): { team: TeamId; name: string } | null {
  const inBothWritingPhase =
    state.phase === "initial_writing" || state.phase === "tie_writing";
  if (inBothWritingPhase && !state.bothWritingFirstDone) return null;
  if (!inBothWritingPhase && state.phase !== "challenge_writing") return null;
  const defending = state.defendingTeam;
  if (!defending) return null;
  return { team: defending, name: currentRunnerName(state.teams[defending]) };
}

/**
 * 次に執筆すべき人（表示用、複数対応）。initial_writing/tie_writingで両チームが
 * 同時執筆中の間は両チーム分（最大2件）、それ以外はcurrentWriterと同じ1件（該当者なしなら0件）を返す。
 */
export function currentWriters(
  state: MatchState,
): { team: TeamId; name: string }[] {
  const inBothWritingPhase =
    state.phase === "initial_writing" || state.phase === "tie_writing";
  if (inBothWritingPhase && !state.bothWritingFirstDone) {
    return (["red", "blue"] as const).map((team) => ({
      team,
      name: currentRunnerName(state.teams[team]),
    }));
  }
  const single = currentWriter(state);
  return single ? [single] : [];
}
