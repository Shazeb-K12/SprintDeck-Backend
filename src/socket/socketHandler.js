const { randomUUID } = require("crypto");

const rooms = {};
const MAX_PLAYERS = 15;
const emojiCooldown = {}; // socket.id -> timestamp

/* =======================
   VOTE DISTRIBUTION
======================= */
const calculateVoteDistribution = (players) => {
  const votes = {};

  players
    .filter((p) => p.role !== "spectator")
    .forEach((p) => {
      if (p.selectedCard !== null && p.selectedCard !== undefined) {
        votes[p.selectedCard] = (votes[p.selectedCard] || 0) + 1;
      }
    });

  let maxVotes = 0;
  let mostVotedCards = [];

  Object.entries(votes).forEach(([card, count]) => {
    if (count > maxVotes) {
      maxVotes = count;
      mostVotedCards = [card];
    } else if (count === maxVotes) {
      mostVotedCards.push(card);
    }
  });

  return { votes, mostVotedCards };
};

/* =======================
   SOCKET HANDLER
======================= */
const socketHandler = (io) => {
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    /* =======================
       CREATE GAME
    ======================= */
    socket.on("create-game", ({ gameName, playerName }, callback) => {
      const roomId = randomUUID().slice(0, 6);

      rooms[roomId] = {
        gameName,
        hostId: socket.id,
        revealed: false,
        votes: {},
        mostVotedCards: [],
        players: [
          {
            socketId: socket.id,
            name: playerName,
            role: "host",
            selectedCard: null,
            disconnected: false,
          },
        ],
      };

      socket.join(roomId);
      callback({ success: true, roomId });
      io.to(roomId).emit("room-update", rooms[roomId]);
    });

    /* =======================
       JOIN GAME
    ======================= */
    socket.on(
      "join-game",
      ({ roomId, playerName, role = "player" }, callback) => {
        const room = rooms[roomId];
        if (!room)
          return callback({ success: false, message: "Room not found" });

        if (room.players.length >= MAX_PLAYERS) {
          return callback({ success: false, message: "Room full" });
        }

        const finalRole = role === "spectator" ? "spectator" : "player";

        room.players.push({
          socketId: socket.id,
          name: playerName,
          role: finalRole,
          selectedCard: null,
          disconnected: false,
        });

        socket.join(roomId);
        callback({ success: true });
        io.to(roomId).emit("room-update", room);
      }
    );

    /* =======================
       REJOIN GAME
    ======================= */
    socket.on("rejoin-game", ({ gameId, playerName, role }) => {
      const room = rooms[gameId];
      if (!room) return;

      const existingPlayer = room.players.find((p) => p.name === playerName);

      if (existingPlayer) {
        existingPlayer.socketId = socket.id;
        existingPlayer.disconnected = false;
      } else {
        room.players.push({
          socketId: socket.id,
          name: playerName,
          role: role || "player",
          selectedCard: null,
          disconnected: false,
        });
      }

      socket.join(gameId);
      io.to(gameId).emit("room-update", room);

      if (room.hostId === socket.id) {
        io.to(socket.id).emit("host-assigned", {
          message: "You are the host!",
        });
      }
    });

    /* =======================
       CARD SELECTION
    ======================= */
    socket.on("select-card", ({ roomId, card }) => {
      const room = rooms[roomId];
      if (!room || room.revealed) return;

      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player || player.role === "spectator") return;

      player.selectedCard = card;

      const allVoted = room.players
        .filter((p) => p.role !== "spectator")
        .every((p) => p.selectedCard !== null);

      if (allVoted) {
        room.revealed = true;
        const { votes, mostVotedCards } = calculateVoteDistribution(
          room.players
        );
        room.votes = votes;
        room.mostVotedCards = mostVotedCards;
      }

      io.to(roomId).emit("room-update", room);
    });

    /* =======================
       MANUAL REVEAL
    ======================= */
    socket.on("reveal-cards", ({ roomId }) => {
      const room = rooms[roomId];
      if (!room || room.revealed) return;
      if (room.hostId !== socket.id) return;

      room.revealed = true;
      const { votes, mostVotedCards } = calculateVoteDistribution(room.players);
      room.votes = votes;
      room.mostVotedCards = mostVotedCards;

      io.to(roomId).emit("room-update", room);
    });

    /* =======================
       RESET ROUND
    ======================= */
    socket.on("reset-round", ({ roomId }) => {
      const room = rooms[roomId];
      if (!room || room.hostId !== socket.id) return;

      room.revealed = false;
      room.votes = {};
      room.mostVotedCards = [];

      room.players.forEach((p) => {
        if (p.role !== "spectator") p.selectedCard = null;
      });

      io.to(roomId).emit("room-update", room);
    });

    /* =======================
       DISCONNECT (REFRESH SAFE)
    ======================= */
    socket.on("disconnect", () => {
      for (const roomId in rooms) {
        const room = rooms[roomId];
        const player = room.players.find((p) => p.socketId === socket.id);
        if (!player) continue;

        player.disconnected = true;

        setTimeout(() => {
          const index = room.players.findIndex(
            (p) => p.socketId === socket.id && p.disconnected
          );
          if (index === -1) return;

          const leavingPlayer = room.players[index];
          room.players.splice(index, 1);

          if (room.hostId === leavingPlayer.socketId) {
            const newHost = room.players.find((p) => p.role !== "spectator");
            if (newHost) {
              room.hostId = newHost.socketId;
              io.to(newHost.socketId).emit("host-assigned", {
                message: "You are now the host!",
              });
            } else {
              delete rooms[roomId];
              return;
            }
          }

          io.to(roomId).emit("room-update", room);
        }, 2000);
      }
    });

    /* =======================
          FIRE EMOJI
    ======================= */
    socket.on("send-emoji", ({ roomId, fromUserId, toUserId, emoji }) => {
      const now = Date.now();
      if (emojiCooldown[socket.id] && now - emojiCooldown[socket.id] < 1000) {
        return;
      }
      emojiCooldown[socket.id] = now;

      const room = rooms[roomId];
      if (!room) return;

      socket.to(roomId).emit("emoji-received", {
        fromUserId,
        toUserId,
        emoji,
      });
    });
  });
};

module.exports = socketHandler;
