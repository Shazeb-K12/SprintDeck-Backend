const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const dotenv = require("dotenv");

//Import socketHandler 
const socketHandler = require("./src/socket/socketHandler");

// Load environment variables
dotenv.config();

const app = express();

const PORT = process.env.PORT || 5000;

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
    origin: process.env.CLIENT_ORIGIN,
  },
});

// Socket logic
socketHandler(io);

// Server start
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
