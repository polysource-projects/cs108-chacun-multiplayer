import type { ServerWebSocket } from 'bun';
import asciiArt from './ascii_art.txt' with { type: 'text' };
import { PrismaClient } from '@prisma/client';

interface WebsocketCtxData {
  gameName: string;
  username: string;
  lastPong: number;
}

interface GameState {
  hasStarted: boolean;
  players: {
    ws: ServerWebSocket<WebsocketCtxData>;
    username: string;
  }[];
}

const MAX_PLAYERS = 5;
const MAX_GAME_NAME_LENGTH = 32;
const MAX_USERNAME_LENGTH = 26;

const prisma = new PrismaClient();
const games = new Map<string, GameState>();

enum GameEvent {
  Join = 'GAMEJOIN',
  JoinDeny = 'GAMEJOIN_DENY',
  JoinAccept = 'GAMEJOIN_ACCEPT',
  Leave = 'GAMELEAVE',
  GameAction = 'GAMEACTION',
  GameActionDeny = 'GAMEACTION_DENY',
  GameEnd = 'GAMEEND',
  GameMessage = 'GAMEMSG',
}

/**
 * Checks wether a game name exists or not.
 * @param gameName  The game id to check
 * @returns True if the game id is valid, false otherwise
 */
function isGameNameValid(gameName: string | undefined): gameName is string {
  return gameName != undefined && gameName.length <= MAX_GAME_NAME_LENGTH;
}

/**
 * Checks wether a username is valid or not.
 * @param username The username to check
 * @returns True if the username is valid, false otherwise
 */
function isUsernameValid(username: string | undefined): username is string {
  // petite biere a SAT ce soir = 26 characters
  return username != undefined && username.length <= MAX_USERNAME_LENGTH;
}

function encodeMessage(event: GameEvent, data: string): string {
  return `${event}.${data}`;
}

function encodePlayerList(game: GameState | undefined) {
  return game?.players.map((player) => player.username).join(',') ?? 'EMPTY';
}

function validatePlayerData(ws: ServerWebSocket<WebsocketCtxData>, game: GameState | undefined = undefined) {
  if (!isGameNameValid(ws.data.gameName)) {
    ws.send(encodeMessage(GameEvent.JoinDeny, 'GAME_NAME_INVALID'));
    return false;
  }
  if (!isUsernameValid(ws.data.username)) {
    ws.send(encodeMessage(GameEvent.JoinDeny, 'USERNAME_INVALID'));
    return false;
  }
  if (game && game.players.some((player) => player.username === ws.data.username)) {
    ws.send(encodeMessage(GameEvent.JoinDeny, 'USERNAME_TAKEN'));
    return false;
  }
  return true;
}

function validateGameAvailability(
  ws: ServerWebSocket<WebsocketCtxData>,
  game: GameState | undefined = undefined
) {
  if (game != undefined && game.players.length >= MAX_PLAYERS) {
    ws.send('GAMEJOIN_DENY.GAME_FULL');
    return false;
  }
  return true;
}

function addAndSubscribePlayerToGame(game: GameState | undefined, ws: ServerWebSocket<WebsocketCtxData>) {
  if (game === undefined) {
    // Create game and add player to it
    games.set(ws.data.gameName, { players: [{ username: ws.data.username, ws }], hasStarted: false });
  } else {
    // Add the player to the game lobby
    game.players.push({ username: ws.data.username, ws });
  }

  // Subscribe to the game events
  ws.subscribe(ws.data.gameName);
  // Send the updated list of players to all players
  const playerList = encodePlayerList(games.get(ws.data.gameName));
  server.publish(ws.data.gameName, encodeMessage(GameEvent.JoinAccept, playerList));
}

function removePlayerFromGame(
  game: GameState,
  ws: ServerWebSocket<WebsocketCtxData>,
  reason = 'PLAYER_LEFT'
) {
  game.players = game.players.filter((player) => player.username !== ws.data.username);
  ws.publish(ws.data.gameName, encodeMessage(GameEvent.Leave, encodePlayerList(game)));
  if (game.hasStarted) {
    ws.publish(ws.data.gameName, encodeMessage(GameEvent.GameEnd, reason));
    games.delete(ws.data.gameName);
  }
}

function isPlayerInGame(game: GameState, username: string) {
  return game.players.some((player) => player.username === username);
}

const PING_INTERVAL = 1000 * 60 * 1;
setInterval(() => {
  games.forEach((game) => {
    game.players.forEach((player) => {
      const lastPing = Date.now() - PING_INTERVAL;
      const lastPong = player.ws.data.lastPong;
      if (lastPing - lastPong > PING_INTERVAL) {
        removePlayerFromGame(game, player.ws, 'PLAYER_TIMEOUT');
        player.ws.close(1000, 'PING_TIMEOUT');
      } else {
        player.ws.ping();
      }
    });
  });
}, PING_INTERVAL);

/**
 * Websocket server that relays messages to all clients subscribed to a game.
 */
const server = Bun.serve<WebsocketCtxData>({
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
    /**
     * Called when a client sends a pong message over a websocket connection.
     * @param ws The websocket connection that sent the pong message
     */
    async pong(ws) {
      const currentGame = games.get(ws.data.gameName);
      if (currentGame) {
        const player = currentGame.players.find((player) => player.ws === ws);
        if (player) {
          ws.data.lastPong = Date.now();
        }
      }
    },
    /**
     * Called when a client sends a message over a websocket connection.
     * @param ws The websocket connection that sent the message
     * @param message The message that was sent
     */
    async message(ws, message) {
      const messageData = message.toString().split('.');
      const [event, data] = messageData;

      let currentGame = games.get(ws.data.gameName);
      if (event === GameEvent.Join) {
        const [gameName, username] = data.split(',');
        ws.data = { gameName, username, lastPong: Date.now() };
        currentGame = games.get(ws.data.gameName);

        if (validatePlayerData(ws, currentGame) && validateGameAvailability(ws, currentGame)) {
          addAndSubscribePlayerToGame(currentGame, ws);
        }

        return;
      }

      if (event === GameEvent.Leave) {
        if (currentGame && isPlayerInGame(currentGame, ws.data.username)) {
          removePlayerFromGame(currentGame, ws);
        }
        return;
      }

      if (event === GameEvent.GameAction) {
        // Check if the player is in a game
        if (currentGame !== undefined && isPlayerInGame(currentGame, ws.data.username)) {
          // Start the game if the player count is enough
          if (
            !currentGame.hasStarted &&
            currentGame.players.length >= 2 &&
            // Check if the player that tried to start the game is the game owner
            ws.data.username === currentGame.players[0].username
          ) {
            currentGame.hasStarted = true;
          }

          if (!currentGame?.hasStarted) {
            ws.send(encodeMessage(GameEvent.GameActionDeny, 'GAME_NOT_STARTED'));
            return;
          }

          // Relay the message to all clients subscribed to the game
          ws.publish(ws.data.gameName, encodeMessage(GameEvent.GameAction, data));
        }
      }

      if (event === GameEvent.GameMessage) {
        if (currentGame !== undefined && isPlayerInGame(currentGame, ws.data.username)) {
          server.publish(ws.data.gameName, encodeMessage(GameEvent.GameMessage, encodeURI(data)));
        }
      }
    },
    /**
     * Called when a client opens a websocket connection.
     * @param ws The websocket connection that was opened
     */
    async open(ws) {
      // Check if the game data is valid
      const currentGame = games.get(ws.data.gameName);
      if (validatePlayerData(ws, currentGame) && validateGameAvailability(ws, currentGame)) {
        addAndSubscribePlayerToGame(currentGame, ws);
      }
      ws.data.lastPong = Date.now();
    },
    /**
     * Called when a client closes a websocket connection.
     * @param ws The websocket connection that was closed
     */
    async close(ws) {
      const currentGame = games.get(ws.data.gameName);
      /*
      const game = await prisma.game.findUnique({
        where: {
          name_hasStarted: {
            name: ws.data.gameName,
            hasStarted: false,
          },
        },
      });
      */

      // If the game has already started, we need to end it
      /*if (game === null) {
        
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

        currentGame.players.forEach((player) =>
          player.ws.close(ErrorCode.PlayerLeft, `${ws.data.username} has left the game!`)
        );
        games.delete(ws.data.gameName);
        return;
      }*/

      /*
      if (code == ErrorCode.PlayerLeft && currentGame.hasStarted) {
        // Remove the player that left
        if (currentGame.hasStarted) {
          currentGame.players.forEach((player) =>
            player.ws.close(ErrorCode.PlayerLeft, `${ws.data.username} has left the game!`)
          );
          currentGame.players = [];
        }
      }
      */

      if (currentGame !== undefined) {
        // Only remove the player if he was in the game
        if (isPlayerInGame(currentGame, ws.data.username)) {
          removePlayerFromGame(currentGame, ws);
        }

        // Delete the game if there are no more players
        if (currentGame.players.length === 0) {
          games.delete(ws.data.gameName);
        }

        // Unsubscribe from the game events
        ws.unsubscribe(ws.data.gameName);
      }
    },
  },
});

console.log(`Listening on ${server.hostname}:${server.port}`);
