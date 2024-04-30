import type { ServerWebSocket } from 'bun';
import asciiArt from './ascii_art.txt' with { type: 'text' };
import { PrismaClient } from '@prisma/client';

interface GameState {
  players: {
    ws: ServerWebSocket<any>;
    username: string;
  }[];
}

const MAX_PLAYERS = 5;

const prisma = new PrismaClient();
const games = new Map<string, GameState>();

/**
 * Checks wether a game name exists or not.
 * @param gameName  The game id to check
 * @returns True if the game id is valid, false otherwise
 */
function isGameNameValid(gameName: string | null): gameName is string {
  return gameName != null && gameName.length <= 32;
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
        ws.close(4000, 'Invalid game id provided (> 32 characters).');
        return;
      }
      if (!isUsernameValid(ws.data.username)) {
        ws.close(4001, 'Invalid username provided (> 26 characters).');
        return;
      }

      const currentGame = games.get(ws.data.gameName);
      const playerData = {
        username: ws.data.username,
        ws: ws,
      };

      if (currentGame != null) {
        // Check if the username is already taken
        if (currentGame.players.some((player) => player.username === ws.data.username)) {
          ws.close(4003, 'Username already taken.');
          return;
        }
        // Check if the game is full
        if (currentGame.players.length >= MAX_PLAYERS) {
          ws.close(4004, 'Game is full.');
          return;
        }
        // Add the player to the game lobby
        currentGame.players.push(playerData)
      }
      else {
        games.set(ws.data.gameName, { players: [playerData] });
      }

      console.log(currentGame?.players)

      // Subscribe to game events
      ws.subscribe(ws.data.gameName);
    },
    /**
     * Called when a client closes a websocket connection.
     * @param ws The websocket connection that was closed
     */
    async close(ws) {
      const game = await prisma.game.findUnique({
        where: {
          name_hasStarted: {
            name: ws.data.gameName,
            hasStarted: false,
          },
        },
      });

      // If the game has already started, we need to end it
      if (game === null) {
        await prisma.game.update({
          where: {
            name_hasStarted: {
              name: ws.data.gameName,
              hasStarted: true,
            },
          },
          data: {
            hasEnded: true,
            hasStarted: false,
            players: [],
          },
        });

        games.delete(ws.data.gameName);
        return;
      }

      const currentGame = <GameState>games.get(ws.data.gameName);
      // Remove the player that left
      currentGame.players = currentGame.players.filter((player) => player.username !== ws.data.username);

      // Delete the game if there are no more players
      if (currentGame.players.length === 0) {
        games.delete(ws.data.gameName);
      }

      // Unsubscribe from the game events
      ws.unsubscribe(ws.data.gameName);
    },
  },
});

console.log(`Listening on ${server.hostname}:${server.port}`);
