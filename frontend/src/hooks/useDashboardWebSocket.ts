import { useEffect } from "react";

import { useAppStore } from "../store/useAppStore";
import type { DashboardBootstrap } from "../types/api";


export function useDashboardWebSocket(token: string | null) {
  const setBootstrap = useAppStore((state) => state.setBootstrap);
  const setWsConnected = useAppStore((state) => state.setWsConnected);

  useEffect(() => {
    if (!token) {
      setWsConnected(false);
      return undefined;
    }

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws/dashboard?token=${token}`);

    socket.addEventListener("open", () => {
      setWsConnected(true);
    });

    socket.addEventListener("close", () => {
      setWsConnected(false);
    });

    socket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data) as { event: string; payload: DashboardBootstrap };
      if (data.event === "dashboard.bootstrap") {
        setBootstrap(data.payload);
      }
    });

    const heartbeat = window.setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send("ping");
      }
    }, 15000);

    return () => {
      window.clearInterval(heartbeat);
      socket.close();
    };
  }, [setBootstrap, setWsConnected, token]);
}
