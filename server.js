const express = require("express");
const session = require("express-session");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.frontendURL || "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

app.use(express.static("public"));
let sessions = {};

io.on("connection", (socket) => {
  socket.on("health-check", ({ sessionId }) => {
    let sessionExists = !!sessions[sessionId];
    socket.emit("health-callback", { sessionHealthy: sessionExists });
  });

  socket.on("create-session", ({ adminUsername }) => {
    const sessionId = uuidv4();
    sessions[sessionId] = {
      admin: socket.id,
      users: [],
      votes: {},
      reveal: false,
      votingActive: false,
      adminUsername: adminUsername,
    };
    socket.emit("session-created", sessionId);
  });

  socket.on("join-session", ({ sessionId, username }) => {
    if (sessions[sessionId]) {
      socket.join(sessionId);
      socket.sessionId = sessionId;
      socket.username = username;
      if (!sessions[sessionId].users.includes(username)) {
        sessions[sessionId].users.push(username);
      }
      if (sessions[sessionId].adminUsername === username) {
        sessions[sessionId].admin = socket.id;
      }
      io.to(sessionId).emit("user-joined", {
        username,
        users: sessions[sessionId].users,
        adminUsername: sessions[sessionId].adminUsername,
        ticketText: sessions[sessionId].adminSubmittedText,
        revealVotes: sessions[sessionId].reveal,
        votingActive: sessions[sessionId].votingActive,
        sessionVotes: sessions[sessionId].votes,
      });
    } else {
      socket.emit("error", "Session not found");
    }
  });

  socket.on("vote", (vote) => {
    const sessionId = socket.sessionId;
    if (sessionId && sessions[sessionId] && !sessions[sessionId].reveal) {
      sessions[sessionId].votes[socket.username] = vote;
      io.to(sessionId).emit("vote", { username: socket.username, vote });
    }
  });

  socket.on("start-the-voting", (sessionId) => {
    if (sessions[sessionId] && sessions[sessionId].admin === socket.id) {
      sessions[sessionId].votingActive = true;
      io.to(sessionId).emit("voting-active");
    }
  });

  socket.on("reveal-votes", (sessionId) => {
    if (sessions[sessionId] && sessions[sessionId].admin === socket.id) {
      sessions[sessionId].reveal = true;
      // sessions[sessionId].votingActive = false;
      io.to(sessionId).emit("votes-revealed");
    }
  });

  socket.on("restart-voting", (sessionId) => {
    if (sessions[sessionId] && sessions[sessionId].admin === socket.id) {
      sessions[sessionId].reveal = false;
      sessions[sessionId].votingActive = false;
      sessions[sessionId].votes = {};
      io.to(sessionId).emit("voting-reset");
    }
  });

  socket.on("admin-input", ({ sessionId, text }) => {
    if (!(sessions[sessionId] && sessions[sessionId].admin === socket.id))
      return;
    sessions[sessionId].adminSubmittedText = text;
    io.to(sessionId).emit("admin-input", { text });
  });

  socket.on("kick-user", ({ sessionId, username }) => {
    if (sessions[sessionId] && sessions[sessionId].admin === socket.id) {
      sessions[sessionId].users = sessions[sessionId].users.filter(
        (user) => user !== username
      );
      delete sessions[sessionId].votes[username];
      io.to(sessionId).emit("user-kicked", {
        username,
        users: sessions[sessionId].users,
      });
      io.to(username).emit("kicked", "You have been kicked from the session.");
    }
  });

  socket.on("username-changed", ({ sessionId, username, oldUsername }) => {
    if (sessions[sessionId]) {
      sessions[sessionId].users = sessions[sessionId].users.filter(
        (user) => user !== oldUsername
      );
      delete sessions[sessionId].votes[oldUsername];
      socket.username = username;
      if (!sessions[sessionId].users.includes(username)) {
        sessions[sessionId].users.push(username);
      }
      io.to(sessionId).emit("user-joined", {
        username,
        oldUsername,
        users: sessions[sessionId].users,
        adminUsername: sessions[sessionId].adminUsername,
        ticketText: sessions[sessionId].adminSubmittedText,
        revealVotes: sessions[sessionId].reveal,
        votingActive: sessions[sessionId].votingActive,
        sessionVotes: sessions[sessionId].votes,
      });
    }
  });

  socket.on("disconnect", () => {
    Object.keys(sessions).forEach((sessionId) => {
      sessions[sessionId].users = sessions[sessionId].users.filter(
        (user) => user !== socket.username
      );
      io.to(sessionId).emit("user-left", {
        username: socket.username,
        users: sessions[sessionId].users,
      });
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
