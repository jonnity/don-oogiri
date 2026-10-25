import { expect, type Page } from '@playwright/test';
import { isDeepStrictEqual } from 'node:util';
import type { MatchState, ServerMessage, TeamId, CreateMatchResponse } from '@don-oogiri/engine';
import type { CreateDemoMatchInput, DemoActions, DemoMatch, DemoUrls, ScreenRole, StateExpectation } from '../types';

export interface Observations { state?: MatchState; sequence: number; acks: { sequence: number; accepted: boolean }[]; errors: string[] }
export function observe(page: Page): Observations {
  const cache: Observations = { sequence: 0, acks: [], errors: [] };
  page.on('websocket', socket => {
    socket.on('framereceived', ({ payload }) => {
      try {
        const message = JSON.parse(payload.toString()) as ServerMessage;
        cache.sequence++;
        if (message.type === 'state') cache.state = message.state;
        if (message.type === 'vote_ack') cache.acks.push({ sequence: cache.sequence, accepted: message.accepted });
        if (message.type === 'error') cache.errors.push(message.message);
      } catch { /* Non-JSON transport messages are not game observations. */ }
    });
  });
  return cache;
}
export class Actions implements DemoActions {
  match?: DemoMatch;
  private joined = false;
  constructor(public pages: Record<ScreenRole, Page>, private observations: Record<ScreenRole, Observations>, private urls: DemoUrls) {}
  async createMatch(input: CreateDemoMatchInput): Promise<DemoMatch> {
    const { mc, projection } = this.pages;
    if (input.redMembers.length !== input.blueMembers.length || input.redMembers.length < 1 || input.redMembers.length > 3) throw new Error('Setup form supports equal teams of 1–3 members');
    await mc.getByLabel('お題', { exact: true }).fill(input.topic);
    await mc.getByRole('radio', { name: new RegExp(`^${input.redMembers.length}人`) }).check();
    for (const [team, members] of [['赤', input.redMembers], ['青', input.blueMembers]] as const) {
      const group = mc.getByRole('group', { name: new RegExp(team), exact: false }).filter({ has: mc.getByLabel('メンバー1', { exact: true }) });
      for (let i = 0; i < members.length; i++) await group.getByLabel(`メンバー${i + 1}`, { exact: true }).fill(members[i]);
    }
    await mc.getByLabel('端から端までの到達時間(秒)', { exact: true }).fill(String(input.edgeToEdgeSeconds));
    await mc.getByLabel('制限時間を設ける', { exact: true }).setChecked(input.timeLimitMinutes !== null);
    if (input.timeLimitMinutes !== null) await mc.getByLabel(/^制限時間\(分\)/).fill(String(input.timeLimitMinutes));
    const responsePromise = mc.waitForResponse(r => r.url() === `${this.urls.serverUrl}/api/matches` && r.request().method() === 'POST');
    await mc.getByRole('button', { name: '試合を作成', exact: true }).click();
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
    const { matchId } = await response.json() as CreateMatchResponse;
    expect(matchId).toMatch(/^[a-f0-9]+$/);
    await expect.poll(() => mc.evaluate(() => (window as Window & { __demoProjection?: string[] }).__demoProjection?.length ?? 0)).toBe(1);
    const captured = await mc.evaluate(() => (window as Window & { __demoProjection?: string[] }).__demoProjection![0]);
    const url = new URL(captured);
    expect(url.origin).toBe(this.urls.mcUrl);
    expect(Object.fromEntries(url.searchParams)).toEqual({ view: 'projection', m: matchId, serverUrl: this.urls.serverUrl, audienceBaseUrl: this.urls.audienceBaseUrl });
    const audience = new URL(this.urls.audienceBaseUrl); audience.searchParams.set('m', matchId);
    this.match = { matchId, projectionUrl: captured, audienceUrl: audience.toString() };
    await projection.goto(captured);
    await this.expectState({ phase: 'setup', topic: input.topic });
    await expect(projection.locator('.projection__topic')).toContainText(input.topic);
    await expect(projection.locator('.projection__qr svg')).toBeVisible();
    await mc.getByRole('heading', { name: '状態', exact: true }).scrollIntoViewIfNeeded();
    return this.match;
  }
  async joinAudience(match: DemoMatch): Promise<void> {
    await this.pages.audience.goto(match.audienceUrl);
    this.joined = true;
    await expect(this.pages.audience.getByRole('heading', { name: 'ドン大喜利 観客投票', exact: true })).toBeVisible();
    await this.expectState({ phase: 'setup' });
  }
  private async serverState(): Promise<MatchState> {
    if (!this.match) throw new Error('Create a match first');
    const response = await this.pages.mc.request.get(`${this.urls.serverUrl}/api/matches/${this.match.matchId}`);
    expect(response.ok()).toBe(true);
    return response.json();
  }
  async expectState(expected: StateExpectation): Promise<MatchState> {
    const matches = typeof expected === 'function' ? expected : (state: MatchState) => Object.entries(expected).every(([key, value]) => isDeepStrictEqual(state[key as keyof MatchState], value));
    let state!: MatchState;
    await expect.poll(async () => matches(state = await this.serverState()), { message: 'Authoritative HTTP state', timeout: 10000 }).toBe(true);
    for (const role of (this.joined ? ['mc', 'projection', 'audience'] : ['mc', 'projection']) as ScreenRole[]) {
      await expect.poll(() => { const snapshot = this.observations[role].state; return !!snapshot && matches(snapshot) && snapshot.phase === state.phase && isDeepStrictEqual(snapshot.audienceVotes, state.audienceVotes); }, { message: `${role} WS state`, timeout: 10000 }).toBe(true);
      expect(this.observations[role].errors).toEqual([]);
    }
    await this.expectUi(state);
    return state;
  }
  private async expectUi(state: MatchState): Promise<void> {
    const badge = state.phase === 'setup' ? '準備中' : state.phase === 'voting' ? '投票中' : state.phase === 'finished' ? '試合終了' : state.movement.status === 'advancing' ? `${state.advancingTeam === 'red' ? '🔴' : '🔵'}進行中` : '両チーム回答中';
    for (const role of ['mc', 'projection'] as const) await expect(this.pages[role].locator('.marker-bar__status')).toContainText(badge);
    if (state.phase === 'voting') await expect(this.pages.mc.locator('.audience-tally')).toContainText(`🔴 ${state.audienceVotes.red} - 🔵 ${state.audienceVotes.blue}`);
    if (this.joined) {
      if (state.phase === 'voting') await expect(this.pages.audience.locator('.voting-section')).toBeVisible();
      else if (state.phase === 'finished') await expect(this.pages.audience.locator('.winner-banner')).toBeVisible();
      else await expect(this.pages.audience.getByText('投票開始をお待ちください', { exact: true })).toBeVisible();
    }
  }
  async startMatch(): Promise<void> {
    await this.pages.mc.getByRole('button', { name: /^試合開始/ }).click();
    await this.expectState({ phase: 'initial_writing' });
  }
  async firstDone(team: TeamId): Promise<void> {
    await this.pages.mc.getByRole('button', { name: new RegExp(`${team === 'red' ? '赤' : '青'}チーム 執筆完了`) }).click();
    await this.expectState(s => s.advancingTeam === team && s.movement.status === 'advancing');
  }
  async nominate(): Promise<void> {
    const round = (await this.serverState()).votingRoundId;
    await this.pages.mc.getByRole('button', { name: /^指名（/ }).click();
    await this.expectState(s => s.phase === 'voting' && s.movement.status === 'frozen' && s.votingRoundId === round + 1);
    await expect(this.pages.audience.getByRole('button', { name: /🔴/ })).toBeVisible();
    await expect(this.pages.audience.getByRole('button', { name: /🔵/ })).toBeVisible();
  }
  private async cast(team: TeamId, change: boolean): Promise<void> {
    const { audience } = this.pages;
    const before = await this.serverState();
    const cache = this.observations.audience;
    const sequence = cache.sequence;
    const previous = change ? await audience.locator('.voted-status').innerText() : '';
    const previousTeam: TeamId | null = previous.includes('🔴') ? 'red' : previous.includes('🔵') ? 'blue' : null;
    if (change) await audience.getByRole('button', { name: '投票を変更する', exact: true }).click();
    await audience.getByRole('button', { name: new RegExp(team === 'red' ? '🔴' : '🔵') }).click();
    // Register before clicking; never accept an optimistic label or a previous ACK.
    const ack = expect.poll(() => cache.acks.find(a => a.sequence > sequence)?.accepted, { message: 'Current vote ACK accepted' }).toBe(true);
    await audience.getByRole('button', { name: change ? 'この内容に変更する' : '決定する', exact: true }).click();
    await ack;
    await expect(audience.locator('.voted-status')).toContainText(team === 'red' ? '🔴' : '🔵');
    const votes = { ...before.audienceVotes };
    if (previousTeam) votes[previousTeam]--;
    votes[team]++;
    await this.expectState({ phase: 'voting', audienceVotes: votes });
  }
  async vote(team: TeamId): Promise<void> { await this.cast(team, false); }
  async changeVote(team: TeamId): Promise<void> { await this.cast(team, true); }
  async closeVoting(): Promise<void> {
    await this.pages.mc.getByRole('button', { name: /^投票を締め切る/ }).click();
    await this.expectState(s => s.phase !== 'voting');
  }
  async hold(ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms < 0 || ms > 5000) throw new Error('hold must be 0–5000ms');
    await this.pages.mc.waitForTimeout(ms);
  }
}
