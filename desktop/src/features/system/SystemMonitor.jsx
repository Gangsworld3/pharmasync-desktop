import { useEffect, useState } from "react";
import { callIpc } from "../../lib/ipc-client";

export default function SystemMonitor() {
  const [traces, setTraces] = useState([]);

  useEffect(() => {
    const interval = setInterval(async () => {
      const data = await callIpc("GET_SYSTEM_TRACES");
      setTraces(data);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <h2>System Brain</h2>
      <pre>{JSON.stringify(traces.slice(-10), null, 2)}</pre>
    </div>
  );
}
