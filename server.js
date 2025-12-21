const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

//Import socketHandler 
const socketHandler = require("./src/socket/socketHandler");

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Test route
app.get("/", (req, res) => {
  res.send("Planning Poker Backend Running");
});

// HTTP server
const server = http.createServer(app);

// Socket.IO
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

// Socket logic
socketHandler(io);

// Server start
const PORT = 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
