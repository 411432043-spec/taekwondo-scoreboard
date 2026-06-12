const express = require('express');
const path = require('path');
const app = express();
const port = process.env.PORT || 8080;

// Serve static files from current directory
app.use(express.static(path.join(__dirname)));

let pendingPresses = [];

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

app.listen(port, () => {
  console.log(`Taekwondo Scoreboard Server running on port ${port}`);
});
