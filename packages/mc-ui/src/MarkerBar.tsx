import { useEffect, useState } from "react";
import { getMarkerPosition, type MatchState } from "@don-oogiri/engine";

interface MarkerBarProps {
  state: MatchState;
  clockOffset: number;
}

/** Phase1向けの簡素なマーカー表示。演出はPhase4で行う。 */
export function MarkerBar({ state, clockOffset }: MarkerBarProps) {
  const [position, setPosition] = useState(() =>
    getMarkerPosition(state, Date.now() + clockOffset),
  );

  useEffect(() => {
    if (state.movement.status !== "advancing") {
      setPosition(getMarkerPosition(state, Date.now() + clockOffset));
      return;
    }
    let raf: number;
    const tick = () => {
      setPosition(getMarkerPosition(state, Date.now() + clockOffset));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, clockOffset]);

  const percent = (position / state.config.laneLength) * 100;

  return (
    <div className="marker-bar">
      <div className="marker-bar__track">
        <span className="marker-bar__edge marker-bar__edge--red">
          🔴 {state.teams.red.name}
        </span>
        <div className="marker-bar__rail">
          <div className="marker-bar__marker" style={{ left: `${percent}%` }} />
        </div>
        <span className="marker-bar__edge marker-bar__edge--blue">
          🔵 {state.teams.blue.name}
        </span>
      </div>
      <p className="marker-bar__position">
        position: {position.toFixed(1)} / {state.config.laneLength}
      </p>
    </div>
  );
}
