import type { CreateMatchRequest, CreateMatchResponse } from "@don-oogiri/engine";

export async function createMatch(
  baseUrl: string,
  req: CreateMatchRequest,
): Promise<CreateMatchResponse> {
  const res = await fetch(`${baseUrl}/api/matches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`試合の作成に失敗しました (${res.status}): ${body}`);
  }
  return res.json();
}
