import {
  checkArrival,
  createMatch,
  IllegalTransitionError,
  nextArrivalTime,
  transition,
  type ClientMessage,
  type CreateMatchRequest,
  type MatchState,
  type ServerMessage,
} from "@don-oogiri/engine";
import type { Env } from "./env.js";

const STORAGE_KEY = "match";

export class MatchRoom implements DurableObject {
  private state: DurableObjectState;
  private sessions = new Set<WebSocket>();
  private match: MatchState | null = null;
  private loaded = false;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    const stored = await this.state.storage.get<MatchState>(STORAGE_KEY);
    this.match = stored ?? null;
    this.loaded = true;
  }

  private async save(match: MatchState): Promise<void> {
    this.match = match;
    await this.state.storage.put(STORAGE_KEY, match);
    await this.syncAlarm(match);
    this.broadcast(match);
  }

  private async syncAlarm(match: MatchState): Promise<void> {
    const arrivalTime = nextArrivalTime(match);
    if (arrivalTime === null) {
      await this.state.storage.deleteAlarm();
    } else {
      await this.state.storage.setAlarm(arrivalTime);
    }
  }

  private broadcast(match: MatchState): void {
    const message: ServerMessage = {
      type: "state",
      state: match,
      serverTime: Date.now(),
    };
    const payload = JSON.stringify(message);
    for (const ws of this.sessions) {
      try {
        ws.send(payload);
      } catch {
        this.sessions.delete(ws);
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    await this.load();
    const url = new URL(request.url);

    if (url.pathname.endsWith("/ws")) {
      return this.handleWebSocketUpgrade(request);
    }
    if (url.pathname === "/create" && request.method === "POST") {
      return this.handleCreate(request);
    }
    if (url.pathname === "/event" && request.method === "POST") {
      return this.handleEvent(request);
    }
    if (url.pathname === "/state" && request.method === "GET") {
      return this.jsonResponse(this.match);
    }
    return new Response("Not found", { status: 404 });
  }

  private handleWebSocketUpgrade(request: Request): Response {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    this.sessions.add(server);

    if (this.match) {
      const message: ServerMessage = {
        type: "state",
        state: this.match,
        serverTime: Date.now(),
      };
      server.send(JSON.stringify(message));
    }

    server.addEventListener("message", (event) => {
      void this.handleClientMessage(server, event.data);
    });
    server.addEventListener("close", () => {
      this.sessions.delete(server);
    });
    server.addEventListener("error", () => {
      this.sessions.delete(server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleClientMessage(
    ws: WebSocket,
    data: string | ArrayBuffer,
  ): Promise<void> {
    let message: ClientMessage;
    try {
      message = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data));
    } catch {
      this.sendError(ws, "invalid JSON message");
      return;
    }
    if (message.type !== "event") {
      this.sendError(ws, `unknown message type: ${(message as { type?: string }).type}`);
      return;
    }
    if (!this.match) {
      this.sendError(ws, "match not created yet");
      return;
    }
    try {
      const next = transition(this.match, message.event, Date.now());
      await this.save(next);
    } catch (err) {
      this.sendError(ws, err instanceof IllegalTransitionError ? err.message : "unexpected error");
    }
  }

  private sendError(ws: WebSocket, msg: string): void {
    const message: ServerMessage = { type: "error", message: msg };
    ws.send(JSON.stringify(message));
  }

  private async handleCreate(request: Request): Promise<Response> {
    const body = (await request.json()) as CreateMatchRequest;
    try {
      const match = createMatch(body.config, body.red, body.blue);
      await this.save(match);
      return this.jsonResponse(match);
    } catch (err) {
      return this.errorResponse(err);
    }
  }

  private async handleEvent(request: Request): Promise<Response> {
    if (!this.match) {
      return this.errorResponse(new Error("match not created yet"), 404);
    }
    const message = (await request.json()) as ClientMessage;
    try {
      const next = transition(this.match, message.event, Date.now());
      await this.save(next);
      return this.jsonResponse(next);
    } catch (err) {
      return this.errorResponse(err);
    }
  }

  async alarm(): Promise<void> {
    await this.load();
    if (!this.match) return;
    const next = checkArrival(this.match, Date.now());
    if (next !== this.match) {
      await this.save(next);
    } else {
      // 端に未到達なら次の到達予定時刻へアラームを再設定する
      await this.syncAlarm(this.match);
    }
  }

  private jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  private errorResponse(err: unknown, status = 400): Response {
    const message = err instanceof Error ? err.message : "unexpected error";
    return this.jsonResponse({ error: message }, status);
  }
}
