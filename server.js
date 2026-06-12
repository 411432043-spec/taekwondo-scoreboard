const express = require('express');
const path = require('path');
const app = express();
const port = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

let pendingPresses = [];
let matchState = null; // Global state store on the cloud server

// Return the hostname/IP of the server to clients
app.get('/api/ip', (req, res) => {
  res.send(req.headers.host);
});

// Endpoint for mobile devices to submit referee presses
app.get('/api/press', (req, res) => {
  const { judge, color, points } = req.query;
  if (judge && color) {
    pendingPresses.push(`${judge}:${color}:${points || 2}`);
  }
  res.send('ok');
});

// Endpoint for scoreboard console to poll referee presses
app.get('/api/poll', (req, res) => {
  const presses = [...pendingPresses];
  pendingPresses = [];
  res.json(presses);
});

// Save the latest scoreboard state on the server
app.post('/api/state', (req, res) => {
  matchState = req.body;
  res.send('ok');
});

// Retrieve the latest scoreboard state from the server
app.get('/api/state', (req, res) => {
  res.json(matchState);
});

app.listen(port, () => {
  console.log(`Taekwondo Scoreboard Server running on port ${port}`);
});
