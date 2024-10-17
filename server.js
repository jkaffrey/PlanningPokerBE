const express = require("express");
const session = require("express-session");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // process.env.frontendURL || "http://localhost:5000",
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
      planSizingTechnique: "fibonacci",
      history: [],
    };
    socket.emit("session-created", sessionId);
  });

  socket.on("join-session", ({ sessionId, username }) => {
    if (sessions[sessionId]) {
      socket.join(sessionId);
      socket.sessionId = sessionId;
      socket.username = username;

      if (
        sessions[sessionId].adminUsername === username ||
        !sessions[sessionId].adminUsername
      ) {
        if (sessions[sessionId].deleteTimeout) {
          clearTimeout(sessions[sessionId].deleteTimeout);
          delete sessions[sessionId].deleteTimeout; // Clean up the timeout reference
        }
        sessions[sessionId].admin = socket.id;
      }

      if (!sessions[sessionId].users.includes(username)) {
        sessions[sessionId].users.push(username);
      }

      io.to(sessionId).emit("user-joined", {
        username,
        users: sessions[sessionId].users,
        adminUsername: sessions[sessionId].adminUsername,
        ticketText: sessions[sessionId].adminSubmittedText,
        revealVotes: sessions[sessionId].reveal,
        votingActive: sessions[sessionId].votingActive,
        sessionVotes: sessions[sessionId].votes,
        planSizingTechnique: sessions[sessionId].planSizingTechnique,
        history: sessions[sessionId].history,
      });
    } else {
      socket.emit("error", {
        title: "Session Not Found",
        message:
          "This session you are attempting to connect to does not exist.",
      });
    }
  });

  socket.on("add-history-event", ({ sessionId, historyEvent }) => {
    // console.log("History event added: ", historyEvent);
    sessions[sessionId].history.push(historyEvent);
    io.to(sessionId).emit("history-updated", sessions[sessionId].history);
  });

  socket.on("change-sizing-technique", ({ sessionId, technique }) => {
    if (!(sessions[sessionId] && sessions[sessionId].admin === socket.id))
      return;
    sessions[sessionId].planSizingTechnique = technique;
    sessions[sessionId].votes = {};
    io.to(sessionId).emit("sizing-technique-changed", { technique });
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
        planSizingTechnique: sessions[sessionId].planSizingTechnique,
        history: sessions[sessionId].history,
      });
    }
  });

  socket.on("disconnect", () => {
    const sessionId = socket.sessionId;
    if (!sessions[sessionId]) return;

    // Remove user from the specific session they are in
    sessions[sessionId].users = sessions[sessionId].users.filter(
      (user) => user !== socket.username
    );

    io.to(sessionId).emit("user-left", {
      username: socket.username,
      users: sessions[sessionId].users,
    });

    // Check if the disconnected user is the admin
    if (sessions[sessionId].admin === socket.id) {
      // Set a timeout to delete the session after 30 seconds
      const deleteSessionTimeout = setTimeout(() => {
        io.to(sessionId).emit("error", {
          title: "The Host Has Left",
          message:
            "This session is no longer active since the host has left for more than 30 seconds.",
        });
        delete sessions[sessionId];
      }, 30000); // 30 seconds

      // Store the timeout ID so it can be cleared if the admin reconnects
      sessions[sessionId].deleteTimeout = deleteSessionTimeout;
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
