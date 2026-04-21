const WebSocket = require("ws");

function createWebsocketHub(server) {
  const wss = new WebSocket.Server({ noServer: true });

  function send(ws, type, payload) {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify({ type, payload }));
  }

  function broadcast(type, payload) {
    for (const client of wss.clients) {
      const resolvedPayload = typeof payload === "function" ? payload(client) : payload;
      send(client, type, resolvedPayload);
    }
  }

  return {
    handleUpgrade(request, socket, head, onAuthenticate) {
      onAuthenticate(request)
        .then((auth) => {
          console.log(`[ws] upgrade autorizado user=${auth.username || "desconhecido"} path=${request.url || "/ws"}`);
          wss.handleUpgrade(request, socket, head, (ws) => {
            ws.auth = auth;
            wss.emit("connection", ws, request);
          });
        })
        .catch((error) => {
          console.error(`[ws] upgrade rejeitado path=${request.url || "/ws"}`, error?.message || error);
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
        });
    },
    onConnection(handler) {
      wss.on("connection", handler);
    },
    send,
    broadcast
  };
}

module.exports = {
  createWebsocketHub
};
