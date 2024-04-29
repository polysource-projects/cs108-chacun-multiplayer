// Keep track of the number of started game sessions to generate new game ids
let lastStartedGameId = 0;

/**
 * Checks wether a game id exists or not.
 * @param gameId  The game id to check.
 * @returns True if the game id exists, false otherwise.
 */
function isGameIdValid(gameId: string | null): gameId is string {
  return gameId != null && parseInt(gameId) <= lastStartedGameId;
}

/**
 * Websocket server that relays messages to all clients subscribed to a game.
 */
const server = Bun.serve<{ gameId: string }>({
  fetch(req, server) {
	// Parse a valid game id or create a new one
    const rawGameId = new URL(req.url).searchParams.get('gameId');
	const gameIdInteger = isGameIdValid(rawGameId) ? rawGameId : ++lastStartedGameId;
	const gameId = gameIdInteger.toString().padStart(4, '0');

	// Attempt to upgrade the connection to a websocket
    const success = server.upgrade(req, { data: { gameId } });
    if (success) {
      // Bun automatically returns a 101 Switching Protocols
      // if the upgrade succeeds
      return undefined;
    }

    // handle HTTP request normally
    return new Response('Hello world!');
  },
  websocket: {
    // this is called when a message is received
    async message(ws, message) {
		if (ws.isSubscribed(ws.data.gameId))
			server.publish(ws.data.gameId, message);
	},
    // this is called when a connection is opened
    async open(ws) {
      ws.subscribe(ws.data.gameId);
      ws.send(`Welcome to game #${ws.data.gameId}!`);
    },
  },
});

console.log(`Listening on ${server.hostname}:${server.port}`);
