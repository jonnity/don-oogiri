import { useState } from "react";

interface AudienceLinkProps {
  matchId: string;
  audienceBaseUrl: string;
}

/** 観客投票ページへのURL。投影画面ではこのURLをQRコード化する。 */
export function buildAudienceUrl(audienceBaseUrl: string, matchId: string): string {
  return `${audienceBaseUrl.replace(/\/$/, "")}/?m=${matchId}`;
}

export function AudienceLink({ matchId, audienceBaseUrl }: AudienceLinkProps) {
  const [copied, setCopied] = useState(false);
  const url = buildAudienceUrl(audienceBaseUrl, matchId);

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
        観客投票URL（スマホで開く。QRコードは投影画面に表示されます）:
        <br />
        <a href={url} target="_blank" rel="noreferrer">
          {url}
        </a>
      </p>
      <button onClick={handleCopy}>{copied ? "コピーしました" : "URLをコピー"}</button>
    </div>
  );
}
