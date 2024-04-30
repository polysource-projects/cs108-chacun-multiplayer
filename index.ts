import asciiArt from './ascii_art.txt' with { type: 'text' };
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Checks wether a game id exists or not.
 * @param gameId  The game id to check
 * @returns True if the game id is valid, false otherwise
 */
function isGameIdValid(gameId: string | null): gameId is string {
  return gameId != null && gameId?.length <= 64;
}

/**
 * Checks wether a username is valid or not.
 * @param username The username to check
 * @returns True if the username is valid, false otherwise
 */
function isUsernameValid(username: string | null): username is string {
  // petite biere a SAT ce soir = 26 characters
  return username != null && username.length <= 26;
}

/**
 * Websocket server that relays messages to all clients subscribed to a game.
 */
const server = Bun.serve<{ gameId: string; username: string }>({
  fetch(req, server) {
    // Parse a valid game id or create a new one
    const url = new URL(req.url);
    const gameId = url.searchParams.get('gameId');
    const username = url.searchParams.get('username');
    // Attempt to upgrade the connection to a websocket
    if (server.upgrade(req, { data: { gameId, username } })) {
      // Bun automatically returns a 101 Switching Protocols if the upgrade succeeds
      return undefined;
    }
    // Handle HTTP request normally
    return new Response(asciiArt);
  },
  websocket: {
    // Allow the server to validate game actions instead of one's client.
    publishToSelf: true,
    /**
     * Called when a client sends a message over a websocket connection.
     * @param ws The websocket connection that sent the message
     * @param message The message that was sent
     */
    async message(ws, message) {
      ws.publish(ws.data.gameId, message);
    },
    /**
     * Called when a client opens a websocket connection.
     * @param ws The websocket connection that was opened
     */
    async open(ws) {
      // Check if the game data is valid
      if (!isGameIdValid(ws.data.gameId)) {
        ws.close(4000, 'Invalid game id provided (> 64 characters).');
        return;
      }
      if (!isUsernameValid(ws.data.username)) {
        ws.close(4001, 'Invalid username provided (> 26 characters).');
        return;
      }

      // Subscribe to game events
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
