const { randomUUID } = require("crypto");

const rooms = {};
const MAX_PLAYERS = 15;

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
       CREATE GAME (HOST)
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
        if (!room) {
          return callback({ success: false, message: "Room not found" });
        }

        if (room.players.length >= MAX_PLAYERS) {
          return callback({ success: false, message: "Room full" });
        }

        const finalRole = role === "spectator" ? "spectator" : "player";

        room.players.push({
          socketId: socket.id,
          name: playerName,
          role: finalRole,
          selectedCard: null,
        });

        socket.join(roomId);
        callback({ success: true });
        io.to(roomId).emit("room-update", room);
      }
    );

    /* =======================
       REJOIN GAME (REFRESH FIX)
    ======================= */
    socket.on("rejoin-game", ({ gameId, playerName, role }) => {
      const room = rooms[gameId];
      if (!room) return;

      const existingPlayer = room.players.find(
        (p) => p.name === playerName
      );

      if (existingPlayer) {
        existingPlayer.socketId = socket.id;
      } else {
        room.players.push({
          socketId: socket.id,
          name: playerName,
          role: role || "player",
          selectedCard: null,
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
       MANUAL REVEAL (HOST)
    ======================= */
    socket.on("reveal-cards", ({ roomId }) => {
      const room = rooms[roomId];
      if (!room || room.revealed) return;
      if (room.hostId !== socket.id) return;

      room.revealed = true;
      const { votes, mostVotedCards } = calculateVoteDistribution(
        room.players
      );
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
       DISCONNECT (SAFE)
    ======================= */
    socket.on("disconnect", () => {
      setTimeout(() => {
        for (const roomId in rooms) {
          const room = rooms[roomId];

          const index = room.players.findIndex(
            (p) => p.socketId === socket.id
          );
          if (index === -1) continue;

          const leavingPlayer = room.players[index];
          room.players.splice(index, 1);

          if (room.hostId === socket.id) {
            const newHost = room.players.find(
              (p) => p.role !== "spectator"
            );

            if (newHost) {
              room.hostId = newHost.socketId;
              io.to(newHost.socketId).emit("host-assigned", {
                message: "You are now the host!",
              });
            } else if (room.players.length === 0) {
              delete rooms[roomId];
              return;
            }
          }

          io.to(roomId).emit("room-update", room);
        }
      }, 2000); // ⏳ refresh grace period
    });
  });
};

module.exports = socketHandler;
