import { $ } from 'bun';
import asciiArt from './ascii_art.txt' with { type: 'text' };
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Checks wether a game name exists or not.
 * @param gameName  The game id to check
 * @returns True if the game id is valid, false otherwise
 */
function isGameNameValid(gameName: string | null): gameName is string {
  return gameName != null && gameName?.length <= 32;
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
const server = Bun.serve<{ gameName: string; username: string }>({
  fetch(req, server) {
    // Parse a valid game id or create a new one
    const url = new URL(req.url);
    const gameName = url.searchParams.get('gameName');
    const username = url.searchParams.get('username');
    // Attempt to upgrade the connection to a websocket
    if (server.upgrade(req, { data: { gameName, username } })) {
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
      ws.publish(ws.data.gameName, message);
    },
    /**
     * Called when a client opens a websocket connection.
     * @param ws The websocket connection that was opened
     */
    async open(ws) {
      // Check if the game data is valid
      if (!isGameNameValid(ws.data.gameName)) {
        ws.close(4000, 'Invalid game id provided (> 64 characters).');
        return;
      }
      if (!isUsernameValid(ws.data.username)) {
        ws.close(4001, 'Invalid username provided (> 26 characters).');
        return;
      }

      await prisma.game.upsert({
        where: {
          name: ws.data.gameName,
          hasEnded: false,
          hasStarted: false,
        },
        create: {
          name: ws.data.gameName,
          players: [ws.data.username],
        },
        update: {
          players: {
            push: ws.data.username,
          },
        },
      });

      // Subscribe to game events
      ws.subscribe(ws.data.gameName);
    },
    /**
     * Called when a client closes a websocket connection.
     * @param ws The websocket connection that was closed
     */
    async close(ws) {
      // Unsubscribe from the game events
      ws.unsubscribe(ws.data.gameName);
    },
  },
});

console.log(`Listening on ${server.hostname}:${server.port}`);
