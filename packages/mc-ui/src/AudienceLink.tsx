import { useState } from "react";

interface AudienceLinkProps {
  matchId: string;
}

const AUDIENCE_UI_PORT = "5174";

/** 観客投票ページへのURL。Phase3で投影画面にQRコードとして表示する予定（現時点ではURLのみ）。 */
function buildAudienceUrl(matchId: string): string {
  return `${window.location.protocol}//${window.location.hostname}:${AUDIENCE_UI_PORT}/?m=${matchId}`;
}

export function AudienceLink({ matchId }: AudienceLinkProps) {
  const [copied, setCopied] = useState(false);
  const url = buildAudienceUrl(matchId);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボードAPIが使えない環境ではURLを選択してコピーしてもらう
    }
  }

  return (
    <div className="audience-link">
      <p>
        観客投票URL（スマホで開く。QRコード化はPhase3で対応）:
        <br />
        <a href={url} target="_blank" rel="noreferrer">
          {url}
        </a>
      </p>
      <button onClick={handleCopy}>{copied ? "コピーしました" : "URLをコピー"}</button>
    </div>
  );
}
