// Keep track of the number of started game sessions to generate new game ids
let lastStartedGameId = 0;

/**
 * Checks wether a game id exists or not.
 * @param gameId  The game id to check.
 * @returns True if the game id exists, false otherwise
 */
function isGameIdValid(gameId: string | null): gameId is string {
  return gameId != null && parseInt(gameId) <= lastStartedGameId;
}

/**
 * Generates a random username.
 * @returns A randomly generated username
 */
function generateUsername() {
  return (Math.random() + 1).toString(36).substring(2, 8);
}

/**
 * Websocket server that relays messages to all clients subscribed to a game.
 */
const server = Bun.serve<{ gameId: string; username: string }>({
  fetch(req, server) {
    // Parse a valid game id or create a new one
    const url = new URL(req.url);
    const rawGameId = url.searchParams.get('gameId');
    const gameIdInteger = isGameIdValid(rawGameId) ? rawGameId : ++lastStartedGameId;
    const gameId = gameIdInteger.toString().padStart(4, '0');
    // Parse the provided username or generate a new one
    const username = url.searchParams.get('username') ?? generateUsername();

    // Attempt to upgrade the connection to a websocket
    const success = server.upgrade(req, { data: { gameId, username } });
    if (success) {
      // Bun automatically returns a 101 Switching Protocols
      // if the upgrade succeeds
      return undefined;
    }

    // handle HTTP request normally
    return new Response('Hello world!');
  },
  websocket: {
    /**
     * Called when a client sends a message over a websocket connection.
     * @param ws The websocket connection that sent the message
     * @param message The message that was sent
     */
    async message(ws, message) {
      if (ws.isSubscribed(ws.data.gameId)) {
        server.publish(ws.data.gameId, message);
      }
    },
    /**
     * Called when a client opens a websocket connection.
     * @param ws The websocket connection that was opened
     */
    async open(ws) {
      // Subscribe to the game events
      ws.subscribe(ws.data.gameId);
    },
    /**
     * Called when a client closes a websocket connection.
     * @param ws The websocket connection that was closed
     */
    async close(ws) {
      // Unsubscribe from the game events
      ws.unsubscribe(ws.data.gameId);
    },
  },
});

console.log(`Listening on ${server.hostname}:${server.port}`);
