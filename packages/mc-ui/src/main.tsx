import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import { ProjectionView } from "./ProjectionView.js";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("#root element not found");
}

function Root() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") === "projection") {
    const matchId = params.get("m");
    const serverUrl = params.get("serverUrl");
    const audienceBaseUrl = params.get("audienceBaseUrl");
    if (!matchId || !serverUrl || !audienceBaseUrl) {
      return <p>投影画面の起動パラメータが不足しています（m / serverUrl / audienceBaseUrl）。</p>;
    }
    return (
      <ProjectionView matchId={matchId} serverUrl={serverUrl} audienceBaseUrl={audienceBaseUrl} />
    );
  }
  return <App />;
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
