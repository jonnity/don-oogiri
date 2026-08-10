import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env.js";

export { MatchRoom } from "./matchRoom.js";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.get("/", (c) =>
  c.json({
    name: "don-oogiri-server",
    status: "ok",
    endpoints: [
      "POST /api/matches",
      "GET /api/matches/:id",
      "POST /api/matches/:id/events",
      "GET /api/matches/:id/ws",
    ],
  }),
);

function stubFor(env: Env, matchId: string) {
  const id = env.MATCH_ROOM.idFromString(matchId);
  return env.MATCH_ROOM.get(id);
}

app.post("/api/matches", async (c) => {
  const id = c.env.MATCH_ROOM.newUniqueId();
  const stub = c.env.MATCH_ROOM.get(id);
  const body = await c.req.text();
  const res = await stub.fetch("https://match-room/create", {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
  });
  if (!res.ok) return res;
  await res.arrayBuffer(); // drain created-state body; client fetches canonical state separately
  return c.json({ matchId: id.toString() });
});

app.get("/api/matches/:id", async (c) => {
  const stub = stubFor(c.env, c.req.param("id"));
  return stub.fetch("https://match-room/state");
});

app.post("/api/matches/:id/events", async (c) => {
  const stub = stubFor(c.env, c.req.param("id"));
  const body = await c.req.text();
  return stub.fetch("https://match-room/event", {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
  });
});

app.get("/api/matches/:id/ws", async (c) => {
  const stub = stubFor(c.env, c.req.param("id"));
  // WebSocketアップグレードはヘッダ/メソッドをそのまま転送する必要があるため元のRequestを渡す。
  // DO側はpathnameの末尾一致でルーティングする。
  return stub.fetch(c.req.raw);
});

export default app;
