import type { Page } from '@playwright/test';
import type { MatchState, TeamId } from '@don-oogiri/engine';

export const roles = ['mc', 'projection', 'audience'] as const;
export type ScreenRole = typeof roles[number];
export interface DemoUrls { serverUrl: string; mcUrl: string; audienceBaseUrl: string }
export interface DemoRunConfig {
  runId: string; scenario: string; runDir: string; urls: DemoUrls;
  ports: { server: number; inspector: number; mc: number; audience: number }; maxBytes: number;
}
export interface CreateDemoMatchInput {
  topic: string; redMembers: readonly string[]; blueMembers: readonly string[];
  edgeToEdgeSeconds: number; timeLimitMinutes: number | null;
}
export interface DemoMatch { matchId: string; audienceUrl: string; projectionUrl: string }
export interface ScreenRecording {
  role: ScreenRole; file: string; viewport: { width: number; height: number };
  calibration: { hostBeforeMs: number; hostAfterMs: number; blackFrameSpanMs?: number; blackEndPtsSeconds?: number; trimStartSeconds?: number };
}
export interface RecordingManifest {
  schemaVersion: 1; status: 'passed' | 'failed'; testCount: number; matchId?: string;
  startedMonoMs: number; endedMonoMs: number; screens: Record<ScreenRole, ScreenRecording>;
}
export interface DemoOutput {
  file: 'demo.mp4'; bytes: number; sha256: string; durationSeconds: number; width: 2560; height: 1080; fps: 25;
}
export interface DemoManifest {
  schemaVersion: 1; runId: string; scenario: string; status: 'running' | 'passed' | 'failed' | 'interrupted';
  createdAt: string; source: { headSha: string; dirty: boolean }; urls: DemoUrls;
  tools: { node: string; playwright: string; chromium: string; ffmpeg: string };
  processes?: { pid?: number; log: string }[];
  recording?: RecordingManifest; output?: DemoOutput; error?: { stage: string; message: string };
}
export type StateExpectation = Partial<Pick<MatchState, 'phase' | 'advancingTeam' | 'defendingTeam' | 'votingRoundId' | 'audienceVotes' | 'topic' | 'winner'>> | ((state: MatchState) => boolean);
export interface DemoActions {
  pages: Record<ScreenRole, Page>;
  match?: DemoMatch;
  createMatch(input: CreateDemoMatchInput): Promise<DemoMatch>;
  joinAudience(match: DemoMatch): Promise<void>;
  startMatch(): Promise<void>;
  firstDone(team: TeamId): Promise<void>;
  nominate(): Promise<void>;
  vote(team: TeamId): Promise<void>;
  changeVote(team: TeamId): Promise<void>;
  closeVoting(): Promise<void>;
  expectState(expected: StateExpectation): Promise<MatchState>;
  hold(ms: number): Promise<void>;
}
