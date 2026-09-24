// ==========================================================================
// Taekwondo Scoring App - Core Logic & Routing
// ==========================================================================

// Global Configuration & State
let state = {
  matchId: "",
  matchClass: "",
  
  blueName: "",
  blueTeam: "",
  blueScore: 0,
  blueGamjeom: 0,
  blueHits: 0,
  blueTurning: 0,
  blueHead: 0,
  blueSupLead: 0,
  blueWins: 0,
  
  redName: "",
  redTeam: "",
  redScore: 0,
  redGamjeom: 0,
  redHits: 0,
  redTurning: 0,
  redHead: 0,
  redSupLead: 0,
  redWins: 0,

  scoringMode: "bestOf3", // "bestOf3" or "totalScore"
  maxGamjeoms: 5, // Round ends when reaching this limit
  roundCount: 3,
  currentRound: 1,
  roundDuration: 60, // seconds
  restDuration: 30, // seconds
  currentTime: 60, // seconds
  isRest: false,
  matchOver: false,
  timerRunning: false,
  timerEndTime: null,
  timestamp: 0,
  
  roundScores: [
    { blue: null, red: null, winner: null },
    { blue: null, red: null, winner: null },
    { blue: null, red: null, winner: null }
  ],
  
  consensusWindow: 1.0, // seconds
  minConsensusJudges: 1, // default to 1 for instant single-tester feedback (can be switched to 2 in control panel)
  pointsPerHit: 2, // points awarded for body kick consensus
  pointLockoutTime: 1.5, // seconds lockout after scoring
  
  // Wireless keypad key mappings
  keys: {
    j1Blue: "1",
    j1Red: "2",
    j2Blue: "3",
    j2Red: "4",
    j3Blue: "5",
    j3Red: "6"
  }
};

// Referee Keypress Tracker (Operator Side)
let judgePresses = {
  blue: {
    1: { 1: 0, 2: 0, 3: 0 },
    2: { 1: 0, 2: 0, 3: 0 },
    3: { 1: 0, 2: 0, 3: 0 },
    4: { 1: 0, 2: 0, 3: 0 },
    5: { 1: 0, 2: 0, 3: 0 }
  },
  red: {
    1: { 1: 0, 2: 0, 3: 0 },
    2: { 1: 0, 2: 0, 3: 0 },
    3: { 1: 0, 2: 0, 3: 0 },
    4: { 1: 0, 2: 0, 3: 0 },
    5: { 1: 0, 2: 0, 3: 0 }
  }
};

let consumedPresses = {
  blue: {
    1: { 1: false, 2: false, 3: false },
    2: { 1: false, 2: false, 3: false },
    3: { 1: false, 2: false, 3: false },
    4: { 1: false, 2: false, 3: false },
    5: { 1: false, 2: false, 3: false }
  },
  red: {
    1: { 1: false, 2: false, 3: false },
    2: { 1: false, 2: false, 3: false },
    3: { 1: false, 2: false, 3: false },
    4: { 1: false, 2: false, 3: false },
    5: { 1: false, 2: false, 3: false }
  }
};

let lastScoreTime = {
  blue: 0,
  red: 0
};

let roundEndedByPenalty = null;

// Broadcast Channel for Inter-window Communication
const channel = new BroadcastChannel("tkd_scoreboard_channel");

// Initialize Web Audio API (Lazy loaded on first interaction)
let audioCtx = null;
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// Synthesized Sound Generator
function playTone(freq, type, duration, delay = 0) {
  initAudio();
  if (!audioCtx) return;
  
  setTimeout(() => {
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
      console.warn("Audio playback failed:", e);
    }
  }, delay);
}

// Point Chime: Pleasant double tone
function playPointSound() {
  playTone(523.25, 'sine', 0.15, 0);   // C5
  playTone(659.25, 'sine', 0.25, 100); // E5
}

// Gam-jeom warning: two short square waves
function playGamjeomSound() {
  playTone(380, 'square', 0.1, 0);
  playTone(380, 'square', 0.1, 150);
}

// End of round: loud electronic buzzer
function playBuzzerSound() {
  initAudio();
  if (!audioCtx) return;
  
  try {
    const duration = 1.6;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, audioCtx.currentTime);
    
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(700, audioCtx.currentTime);
    
    gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.25, audioCtx.currentTime + duration - 0.3);
    gain.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {
    console.warn("Buzzer playback failed:", e);
  }
}

// ==========================================================================
// Offline SVG Flags Database (Clean, scalable vectors)
// ==========================================================================
const flagsDB = {
  CHN: `<svg viewBox="0 0 30 20" width="100%" height="100%"><rect width="30" height="20" fill="#de2910"/><path d="M5 5l-.5 1.5H3l1.2.9-.5 1.5 1.3-.9 1.3.9-.5-1.5L8 6.5H6.5z" fill="#ffde00"/><path d="M10 2l-.1.5H9.4l.4.3-.2.5.4-.3.4.3-.2-.5.4-.3h-.5zM12 4.5l-.1.5h-.5l.4.3-.2.5.4-.3.4.3-.2-.5.4-.3H12zM12 7.5l-.1.5h-.5l.4.3-.2.5.4-.3.4.3-.2-.5.4-.3H12zM10 10l-.1.5H9.4l.4.3-.2.5.4-.3.4.3-.2-.5.4-.3h-.5z" fill="#ffde00" transform="rotate(-15,10,2) rotate(15,12,4.5) rotate(45,12,7.5) rotate(60,10,10)"/></svg>`,
  AND: `<svg viewBox="0 0 12 8" width="100%" height="100%"><rect width="4" height="8" fill="#0018a8"/><rect x="4" width="4" height="8" fill="#fedf00"/><rect x="8" width="4" height="8" fill="#d50032"/><circle cx="6" cy="4" r="1" fill="#c60c30"/></svg>`,
  KOR: `<svg viewBox="0 0 36 24" width="100%" height="100%"><rect width="36" height="24" fill="#ffffff"/><circle cx="18" cy="12" r="6" fill="#cd2e3a"/><path d="M18 18a3 3 0 0 1 0-6 3 3 0 0 0 0-6 6 6 0 0 0 0 12z" fill="#0047a0"/><g stroke="#000" stroke-width="1.5"><path d="M8.3 7.2l3.4 5.1M9.3 6.5l3.4 5.1M10.3 5.8l3.4 5.1" transform="rotate(-33.7,18,12)"/><path d="M22.3 11.7l3.4-5.1M23.3 11l3.4-5.1M24.3 12.4l3.4-5.1" transform="rotate(33.7,18,12)"/><path d="M8.3 11.7l3.4-5.1M10.3 12.4l3.4-5.1M9.3 11l3.4-5.1" transform="rotate(-33.7,18,12)"/><path d="M22.3 7.2l3.4 5.1M24.3 5.8l3.4 5.1M23.3 6.5l3.4 5.1" transform="rotate(33.7,18,12)"/></g></svg>`,
  TPE: `<svg viewBox="0 0 30 20" width="100%" height="100%"><rect width="30" height="20" fill="#fe0000"/><rect width="15" height="10" fill="#000095"/><circle cx="7.5" cy="5" r="2" fill="#ffffff"/><path d="M7.5 1.5L7.5 8.5M4 5L11 5M5 2.5L10 7.5M5 7.5L10 2.5" stroke="#ffffff" stroke-width="0.8"/></svg>`,
  USA: `<svg viewBox="0 0 74 39" width="100%" height="100%"><rect width="74" height="39" fill="#bb133e"/><path d="M0 3h74M0 9h74M0 15h74M0 21h74M0 27h74M0 33h74" stroke="#ffffff" stroke-width="3"/><rect width="29.6" height="21" fill="#002147"/><circle cx="14.8" cy="10.5" r="7" fill="white" opacity="0.3"/></svg>`,
  JPN: `<svg viewBox="0 0 30 20" width="100%" height="100%"><rect width="30" height="20" fill="#ffffff"/><circle cx="15" cy="10" r="6" fill="#bc002d"/></svg>`,
  GBR: `<svg viewBox="0 0 60 30" width="100%" height="100%"><rect width="60" height="30" fill="#012169"/><path d="M0 0l60 30M60 0L0 30" stroke="#ffffff" stroke-width="6"/><path d="M0 0l60 30M60 0L0 30" stroke="#c8102e" stroke-width="4"/><path d="M30 0v30M0 15h60" stroke="#ffffff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#c8102e" stroke-width="6"/></svg>`,
  FRA: `<svg viewBox="0 0 9 6" width="100%" height="100%"><rect width="3" height="6" fill="#00209f"/><rect x="3" width="3" height="6" fill="#ffffff"/><rect x="6" width="3" height="6" fill="#e4002b"/></svg>`,
  GER: `<svg viewBox="0 0 5 3" width="100%" height="100%"><rect width="5" height="1" fill="#000000"/><rect y="1" width="5" height="1" fill="#dd0000"/><rect y="2" width="5" height="1" fill="#ffce00"/></svg>`,
  AUS: `<svg viewBox="0 0 60 30" width="100%" height="100%"><rect width="60" height="30" fill="#012169"/><circle cx="45" cy="22" r="3" fill="white"/><circle cx="45" cy="7" r="4" fill="white"/></svg>`
};

function getFlagMarkup(countryCode) {
  const code = (countryCode || "").toUpperCase().trim();
  if (flagsDB[code]) {
    return flagsDB[code];
  }
  // Generic fall back - styling text badge
  return `<div class="sb-flag-placeholder">${code || "🏳️"}</div>`;
}

// ==========================================================================
// Routing Engine
// ==========================================================================
function route() {
  const hash = window.location.hash || "#launcher";
  
  // Hide all screens
  document.getElementById("view-launcher").style.display = "none";
  document.getElementById("view-control").style.display = "none";
  document.getElementById("view-scoreboard").style.display = "none";
  document.getElementById("view-split").style.display = "none";
  
  if (hash === "#launcher") {
    document.getElementById("view-launcher").style.display = "flex";
    initLauncher();
  } else if (hash === "#control") {
    document.getElementById("view-control").style.display = "grid";
    initControl();
  } else if (hash === "#scoreboard") {
    document.getElementById("view-scoreboard").style.display = "flex";
    initScoreboard();
  } else if (hash === "#split") {
    document.getElementById("view-split").style.display = "grid";
    initSplit();
  }
}

// ==========================================================================
// Launcher Screen Logic
// ==========================================================================
function initLauncher() {
  // Simple listener setup
  document.getElementById("btn-launch-dual").onclick = (e) => {
    e.preventDefault();
    initAudio();
    // Open scoreboard in popup window
    const popup = window.open(window.location.pathname + "#scoreboard", "ScoreboardDisplay", "width=1200,height=800");
    if (!popup) {
      alert("Popup blocked! Please allow popups to open the dual window scoreboard, or use Split Screen Mode.");
    }
    // Redirect current page to control panel
    window.location.hash = "#control";
  };
}

// ==========================================================================
// Split Screen Logic
// ==========================================================================
function initSplit() {
  const pane1 = document.getElementById("split-control-pane");
  const pane2 = document.getElementById("split-scoreboard-pane");
  
  pane1.src = window.location.pathname + "#control";
  pane2.src = window.location.pathname + "#scoreboard";
}

// ==========================================================================
// Scoreboard Display Screen Logic
// ==========================================================================
let lastAppliedTimestamp = 0;
let scoreboardTimerLoop = null;
let localTimerEndTime = null;

function initScoreboard() {
  console.log("Scoreboard view initialized");
  
  // Sync initial state from localStorage if available
  const stored = localStorage.getItem("tkd_state");
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed.blueName === "Jim") parsed.blueName = "";
      if (parsed.redName === "Jack") parsed.redName = "";
      if (parsed.blueTeam === "Washington") parsed.blueTeam = "";
      if (parsed.redTeam === "New York") parsed.redTeam = "";
      if (parsed.matchId === "A1005") parsed.matchId = "";
      if (parsed.matchClass === "1/2+ChildMale-25KG") parsed.matchClass = "";
      updateScoreboardState(parsed);
    } catch(e) {}
  }

  // Handle incoming broadcasts
  channel.onmessage = (event) => {
    const msg = event.data;
    if (msg.type === "STATE_UPDATE") {
      updateScoreboardState(msg.state);
    } else if (msg.type === "JUDGE_HIT_INDICATOR") {
      flashJudgeIndicator(msg.judgeIndex, msg.color);
    } else if (msg.type === "PLAY_SOUND") {
      if (msg.sound === "point") playPointSound();
      if (msg.sound === "gamjeom") playGamjeomSound();
      if (msg.sound === "buzzer") playBuzzerSound();
    }
  };

  // Start polling server state for cross-device/cross-window robustness (heartbeat)
  setInterval(() => {
    fetch("/api/state")
      .then(res => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(serverState => {
        if (serverState) {
          updateScoreboardState(serverState);
        }
      })
      .catch(e => {});
  }, 1000);

  // Scoreboard key listener (allows forwarding keyboard hits if focused)
  window.addEventListener("keydown", handleScoreboardKeyboardInput);
}

function startScoreboardTimerLoop() {
  if (scoreboardTimerLoop) return;
  scoreboardTimerLoop = setInterval(() => {
    if (!state.timerRunning || !localTimerEndTime) {
      clearInterval(scoreboardTimerLoop);
      scoreboardTimerLoop = null;
      return;
    }
    const remaining = Math.max(0, (localTimerEndTime - Date.now()) / 1000);
    updateTimerDisplay(remaining);
  }, 30); // ~33fps for continuous, smooth tenth-of-a-second countdown
}

function updateScoreboardState(newState) {
  if (!newState) return;
  
  // Prevent older out-of-order state (from delayed network/fetch responses) from overwriting newer state
  if (newState.timestamp && newState.timestamp < lastAppliedTimestamp) {
    return;
  }
  if (newState.timestamp) {
    lastAppliedTimestamp = newState.timestamp;
  }

  const oldScore = { blue: state.blueScore, red: state.redScore };
  state = newState;

  // Synchronize local countdown end time stably without latency jitter
  if (state.timerRunning && state.timerEndTime) {
    if (!localTimerEndTime || Math.abs(localTimerEndTime - state.timerEndTime) > 800) {
      localTimerEndTime = state.timerEndTime;
    }
    startScoreboardTimerLoop();
  } else {
    localTimerEndTime = null;
    if (scoreboardTimerLoop) {
      clearInterval(scoreboardTimerLoop);
      scoreboardTimerLoop = null;
    }
  }

  renderScoreboardDOM();
  
  // Pulse animation on score increment
  if (state.blueScore > oldScore.blue) {
    pulseScore("blue");
  }
  if (state.redScore > oldScore.red) {
    pulseScore("red");
  }
}

function handleScoreboardKeyboardInput(e) {
  // Simply forward the key to the control channel
  // If scoreboard is full screen on second display, keypresses will still score!
  channel.postMessage({ type: "KEY_PRESS", key: e.key });
}

function renderScoreboardDOM() {
  // Toggle rest-mode and match-over class on public scoreboard wrapper
  const sbWrapper = document.getElementById("view-scoreboard");
  const isMatchOver = Boolean(
    state.matchOver || 
    (state.scoringMode === "bestOf3" && (state.blueWins >= 2 || state.redWins >= 2)) ||
    (state.scoringMode === "totalScore" && state.currentRound >= 3 && state.isRest)
  );

  if (sbWrapper) {
    sbWrapper.classList.toggle("rest-mode", Boolean(state.isRest || isMatchOver));
    sbWrapper.classList.toggle("match-over", isMatchOver);
  }

  // Update Match Details
  const matchIdElem = document.getElementById("sb-match-id");
  if (matchIdElem) matchIdElem.textContent = state.matchId ? (state.matchId + " MATCH") : "";
  const matchClassElem = document.getElementById("sb-match-class");
  if (matchClassElem) matchClassElem.textContent = state.matchClass || "";
  const roundNumElem = document.getElementById("sb-round-num");
  if (roundNumElem) roundNumElem.textContent = state.currentRound;
  const roundLabelElem = document.getElementById("sb-round-label");
  if (roundLabelElem) {
    roundLabelElem.textContent = "ROUND"; // Always display ROUND (not REST)
  }

  // Blue Side Info
  const blueNameElem = document.getElementById("sb-blue-name");
  if (blueNameElem) blueNameElem.textContent = state.blueName || "";
  const blueTeamElem = document.getElementById("sb-blue-team");
  if (blueTeamElem) blueTeamElem.textContent = state.blueTeam || "";
  
  // During rest / match-over: giant score switches to 大分 (state.blueWins)
  const blueScoreElem = document.getElementById("sb-blue-score");
  if (blueScoreElem) {
    blueScoreElem.textContent = (state.isRest || isMatchOver) ? state.blueWins : state.blueScore;
  }

  const blueGamjeomElem = document.getElementById("sb-blue-gamjeom");
  if (blueGamjeomElem) blueGamjeomElem.textContent = state.blueGamjeom;
  const blueHitsElem = document.getElementById("sb-blue-hits");
  if (blueHitsElem) blueHitsElem.textContent = state.blueHits;
  const blueSupLeadElem = document.getElementById("sb-blue-suplead");
  if (blueSupLeadElem) blueSupLeadElem.textContent = state.blueSupLead !== undefined ? state.blueSupLead : 0;
  
  // Red Side Info
  const redNameElem = document.getElementById("sb-red-name");
  if (redNameElem) redNameElem.textContent = state.redName || "";
  const redTeamElem = document.getElementById("sb-red-team");
  if (redTeamElem) redTeamElem.textContent = state.redTeam || "";
  
  // During rest / match-over: giant score switches to 大分 (state.redWins)
  const redScoreElem = document.getElementById("sb-red-score");
  if (redScoreElem) {
    redScoreElem.textContent = (state.isRest || isMatchOver) ? state.redWins : state.redScore;
  }

  const redGamjeomElem = document.getElementById("sb-red-gamjeom");
  if (redGamjeomElem) redGamjeomElem.textContent = state.redGamjeom;
  const redHitsElem = document.getElementById("sb-red-hits");
  if (redHitsElem) redHitsElem.textContent = state.redHits;
  const redSupLeadElem = document.getElementById("sb-red-suplead");
  if (redSupLeadElem) redSupLeadElem.textContent = state.redSupLead !== undefined ? state.redSupLead : 0;

  // Round Win Dots
  updateWinDots("sb-blue-win-dots", state.blueWins);
  updateWinDots("sb-red-win-dots", state.redWins);

  // Render Sub-round scores (R1, R2, R3)
  renderRoundHistoryDOM();

  // Central Timer
  if (state.timerRunning && localTimerEndTime) {
    const remaining = Math.max(0, (localTimerEndTime - Date.now()) / 1000);
    updateTimerDisplay(remaining);
  } else {
    updateTimerDisplay(state.currentTime);
  }
}

function renderRoundHistoryDOM() {
  const roundScores = state.roundScores || [];
  
  for (let r = 1; r <= 3; r++) {
    const entry = roundScores[r - 1];
    const hasPlayed = Boolean(entry && entry.blue !== null && entry.red !== null);
    
    // Blue Side (Standard stat-box: score or --)
    const blueScore = document.getElementById(`sb-blue-r${r}-score`);
    if (blueScore) {
      blueScore.textContent = hasPlayed ? entry.blue : "--";
    }

    // Red Side (Standard stat-box: score or --)
    const redScore = document.getElementById(`sb-red-r${r}-score`);
    if (redScore) {
      redScore.textContent = hasPlayed ? entry.red : "--";
    }

    // Control Panel Summary (if exists)
    const ctrlHistory = document.getElementById(`ctrl-history-r${r}`);
    if (ctrlHistory) {
      ctrlHistory.textContent = hasPlayed ? `${entry.blue} : ${entry.red}` : "-- : --";
      if (hasPlayed && entry.winner === "blue") {
        ctrlHistory.style.color = "#60a5fa";
      } else if (hasPlayed && entry.winner === "red") {
        ctrlHistory.style.color = "#f87171";
      } else {
        ctrlHistory.style.color = hasPlayed ? "#fbbf24" : "#94a3b8";
      }
    }
  }

  // Update control panel status tag
  const ctrlStatusTag = document.getElementById("ctrl-round-status-tag");
  if (ctrlStatusTag) {
    if (state.isRest) {
      ctrlStatusTag.textContent = `第 ${state.currentRound} 局休息中 (REST)`;
      ctrlStatusTag.style.backgroundColor = "#10b981";
    } else {
      ctrlStatusTag.textContent = `第 ${state.currentRound} 局進行中 (MATCH)`;
      ctrlStatusTag.style.backgroundColor = "#3b82f6";
    }
  }
}

function updateWinDots(elementId, winsCount) {
  const container = document.getElementById(elementId);
  if (!container) return;
  if (container.dataset.renderedWins === String(winsCount)) return;
  container.dataset.renderedWins = String(winsCount);

  container.innerHTML = "";
  // In reference image: best of 3, shows up to 2 active purple circles
  for (let i = 1; i <= 2; i++) {
    const dot = document.createElement("div");
    dot.className = `win-dot ${i <= winsCount ? 'active' : ''}`;
    dot.textContent = i;
    container.appendChild(dot);
  }
}

function updateTimerDisplay(currentTime) {
  const timerBox = document.getElementById("sb-timer-box");
  const display = document.getElementById("sb-timer-display");
  const label = document.getElementById("sb-timer-label");
  if (!timerBox || !display || !label) return;

  // Stable class toggling (prevents removing & re-adding classes which causes CSS transition flashing)
  timerBox.classList.toggle("active", Boolean(state.timerRunning));
  timerBox.classList.toggle("rest-time", Boolean(state.isRest));
  label.textContent = state.isRest ? "REST" : "MATCH";

  // Time format
  const timeVal = (currentTime !== undefined) ? currentTime : state.currentTime;
  display.textContent = formatTime(timeVal);
}

function formatTime(totalSeconds) {
  if (totalSeconds <= 0) {
    return (!state.isRest) ? "0.0" : "0:00";
  }
  
  // Show tenths of a second in the last 10 seconds of round (not rest)
  if (totalSeconds <= 10 && !state.isRest) {
    return totalSeconds.toFixed(1);
  }
  
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function pulseScore(color) {
  const elem = document.getElementById(`sb-${color}-score`);
  if (!elem) return;
  elem.classList.remove("score-pulse");
  void elem.offsetWidth; // Trigger reflow
  elem.classList.add("score-pulse");
}

function flashJudgeIndicator(judgeIndex, color) {
  const dot = document.getElementById(`sb-indicator-j${judgeIndex}`);
  if (!dot) return;
  
  dot.classList.remove("blue-active", "red-active");
  void dot.offsetWidth; // Reflow
  dot.classList.add(`${color}-active`);
  
  setTimeout(() => {
    dot.classList.remove(`${color}-active`);
  }, 400);
}


// ==========================================================================
// Operator Control Panel Screen Logic
// ==========================================================================
let timerInterval = null;

function initControl() {
  console.log("Operator Console view initialized");
  
  // Load state
  const stored = localStorage.getItem("tkd_state");
  if (stored) {
    try {
      state = JSON.parse(stored);
      state.timerRunning = false;
      state.timerEndTime = null;
      if (state.blueName === "Jim") state.blueName = "";
      if (state.redName === "Jack") state.redName = "";
      if (state.blueTeam === "Washington") state.blueTeam = "";
      if (state.redTeam === "New York") state.redTeam = "";
      if (state.matchId === "A1005") state.matchId = "";
      if (state.matchClass === "1/2+ChildMale-25KG") state.matchClass = "";
    } catch(e) {}
  }
  
  // Set up forms & buttons matching state
  syncControlForm();
  renderControlDOM();
  logEvent("System initialized. Ready for match.");

  // Broadcast current state to ensure syncing on launch
  broadcastState();

  // Watch for BroadcastChannel messages (key presses from scoreboard window)
  channel.onmessage = (event) => {
    const msg = event.data;
    if (msg.type === "KEY_PRESS") {
      processKeyboardScoring(msg.key);
    }
  };

  // Keyboard listener for local keypresses
  window.addEventListener("keydown", (e) => {
    // If operator is typing in an input field, do not capture scoring shortcuts!
    if (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "SELECT") {
      return;
    }
    
    // Prevent default scroll behaviors for spacebar
    if (e.key === " ") {
      e.preventDefault();
      toggleTimer();
    } else {
      processKeyboardScoring(e.key);
    }
  });

  // Settings form change listeners
  document.getElementById("btn-apply-settings").onclick = applySettings;
  document.getElementById("btn-reset-match").onclick = resetMatchFully;
  document.getElementById("btn-next-round").onclick = forceEndPeriod;
  
  // Timer buttons
  document.getElementById("btn-timer-toggle").onclick = toggleTimer;
  document.getElementById("btn-timer-plus10").onclick = () => adjustTimer(10);
  document.getElementById("btn-timer-minus10").onclick = () => adjustTimer(-10);

  // Manual Adjustments
  setupAdjustmentButtons();

  // Mobile scoring setup
  initMobileScoring();
}

function broadcastState() {
  state.timestamp = Date.now();
  try {
    localStorage.setItem("tkd_state", JSON.stringify(state));
  } catch (e) {}
  channel.postMessage({ type: "STATE_UPDATE", state: state });
  
  // Post state to server for cross-device/cross-window synchronization
  fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state)
  }).catch(e => {});
}

function broadcastSound(soundName) {
  channel.postMessage({ type: "PLAY_SOUND", sound: soundName });
  // Play locally too
  if (soundName === "point") playPointSound();
  if (soundName === "gamjeom") playGamjeomSound();
  if (soundName === "buzzer") playBuzzerSound();
}

function logEvent(text) {
  const logContainer = document.getElementById("ctrl-log");
  if (!logContainer) return;
  
  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0] + "." + Math.floor(now.getMilliseconds()/100);
  const entry = document.createElement("div");
  entry.className = "log-entry";
  
  // Color code some keywords
  if (text.includes("Consensus")) entry.classList.add("point");
  else if (text.includes("Gam-jeom") || text.includes("penalty")) entry.classList.add("gamjeom");
  else if (text.includes("Timer") || text.includes("Round")) entry.classList.add("timer");
  
  entry.textContent = `[${timeStr}] ${text}`;
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;
}

// Map keyboard shortcuts to Judge Actions
function processKeyboardScoring(key) {
  const k = key.toLowerCase();
  
  // Find matching configuration mapping
  let matched = false;
  let color = "";
  let judgeIndex = 0;
  
  if (k === state.keys.j1Blue.toLowerCase()) { color = "blue"; judgeIndex = 1; matched = true; }
  else if (k === state.keys.j1Red.toLowerCase()) { color = "red"; judgeIndex = 1; matched = true; }
  else if (k === state.keys.j2Blue.toLowerCase()) { color = "blue"; judgeIndex = 2; matched = true; }
  else if (k === state.keys.j2Red.toLowerCase()) { color = "red"; judgeIndex = 2; matched = true; }
  else if (k === state.keys.j3Blue.toLowerCase()) { color = "blue"; judgeIndex = 3; matched = true; }
  else if (k === state.keys.j3Red.toLowerCase()) { color = "red"; judgeIndex = 3; matched = true; }
  
  if (!matched) return;

  processJudgeScoring(judgeIndex, color, state.pointsPerHit, "Keyboard");
}

function processJudgeScoring(judgeIndex, color, points, deviceType = "Mobile") {
  // Visual flash for judge hit indicator (local and broadcast to scoreboard)
  flashControlJudgeIndicator(judgeIndex, color);
  channel.postMessage({ type: "JUDGE_HIT_INDICATOR", judgeIndex: judgeIndex, color: color });

  logEvent(`Judge ${judgeIndex} pressed ${color.toUpperCase()} +${points}pt (${deviceType})`);
  
  // Check consensus (awards score, confirmed hit, and recalculates WT superiority)
  checkConsensus(judgeIndex, color, points);
  
  // Update UI and broadcast
  renderControlDOM();
  broadcastState();
}

let mobilePollInterval = null;

function initMobileScoring() {
  const qrContainer = document.getElementById("qrcode-container");
  const qrStatus = document.getElementById("qr-status-msg");
  const qrUrlText = document.getElementById("qr-url-text");
  
  if (!qrContainer) return;
  
  fetch("/api/ip")
    .then(res => {
      if (!res.ok) throw new Error("Not running server");
      return res.text();
    })
    .then(ip => {
      const cleanIp = ip.trim();
      let mobileUrl;
      // If it looks like localhost or raw IP, append port 8080
      if (cleanIp.includes("localhost") || /^[0-9.]+$/.test(cleanIp.split(":")[0])) {
        // If it already has a port in cleanIp, don't double append
        mobileUrl = cleanIp.includes(":") ? `http://${cleanIp}/mobile.html` : `http://${cleanIp}:8080/mobile.html`;
      } else {
        // Cloud hosting (HTTPS/HTTP depending on environment)
        mobileUrl = `${window.location.protocol}//${cleanIp}/mobile.html`;
      }
      
      qrStatus.innerHTML = `✅ <strong>伺服器已啟動！</strong><br>請掃描下方 QR Code 連線評分：`;
      qrContainer.style.display = "block";
      
      // Clear container and render QR
      qrContainer.innerHTML = "";
      new QRCode(qrContainer, {
        text: mobileUrl,
        width: 130,
        height: 130
      });
      
      qrUrlText.textContent = mobileUrl;
      
      // Start polling for referee inputs
      if (mobilePollInterval) clearInterval(mobilePollInterval);
      mobilePollInterval = setInterval(pollMobileInputs, 100);
    })
    .catch(err => {
      console.log("Not running local server, QR disabled:", err);
      qrStatus.innerHTML = `💡 <strong>離線提示：</strong><br>如需手機評分，請在主機執行 <code style="background:#1e293b;padding:2px 4px;border-radius:4px;">.\\start_server.ps1</code> 後重新載入此頁面。`;
      qrContainer.style.display = "none";
      qrUrlText.textContent = "";
    });
}

function pollMobileInputs() {
  fetch("/api/poll")
    .then(res => res.json())
    .then(presses => {
      if (Array.isArray(presses) && presses.length > 0) {
        presses.forEach(press => {
          // Format is "judgeNum:color:points"
          const parts = press.split(":");
          if (parts.length >= 2) {
            const judgeNum = parseInt(parts[0]);
            const color = parts[1];
            const points = parts.length >= 3 ? parseInt(parts[2]) : state.pointsPerHit;
            processJudgeScoring(judgeNum, color, points, "Mobile");
          }
        });
      }
    })
    .catch(err => {
      // Do not kill polling interval on transient network error
      console.warn("Mobile polling notice:", err);
    });
}

function flashControlJudgeIndicator(judgeIndex, color) {
  const el = document.getElementById(`ctrl-indicator-j${judgeIndex}-${color}`);
  if (!el) return;
  
  el.classList.add(`${color}-active`);
  setTimeout(() => {
    el.classList.remove(`${color}-active`);
  }, 350);
}

function updateSuperiorityLead() {
  // WT Competition Rules (Article 15 - Decision of Superiority):
  // 1. Most points / count scored by turning kicks (4pt & 5pt)
  // 2. High-value techniques: Head kicks (3pt & 5pt)
  // 3. Higher number of registered hits (HITS)
  // 4. Fewer penalties (GAM-JEOM)
  // 5. Complete tie: 0 vs 0

  const blueTurning = state.blueTurning || 0;
  const redTurning = state.redTurning || 0;

  if (blueTurning !== redTurning) {
    if (blueTurning > redTurning) {
      state.blueSupLead = blueTurning - redTurning;
      state.redSupLead = 0;
    } else {
      state.blueSupLead = 0;
      state.redSupLead = redTurning - blueTurning;
    }
    return;
  }

  // Tier 2: Head kicks (3pt & 5pt)
  const blueHead = state.blueHead || 0;
  const redHead = state.redHead || 0;
  if (blueHead !== redHead) {
    if (blueHead > redHead) {
      state.blueSupLead = blueHead - redHead;
      state.redSupLead = 0;
    } else {
      state.blueSupLead = 0;
      state.redSupLead = redHead - blueHead;
    }
    return;
  }

  // Tier 3: Registered hits
  const blueHits = state.blueHits || 0;
  const redHits = state.redHits || 0;
  if (blueHits !== redHits) {
    if (blueHits > redHits) {
      state.blueSupLead = blueHits - redHits;
      state.redSupLead = 0;
    } else {
      state.blueSupLead = 0;
      state.redSupLead = redHits - blueHits;
    }
    return;
  }

  // Tier 4: Fewer penalties (Gam-jeom)
  const blueGamjeom = state.blueGamjeom || 0;
  const redGamjeom = state.redGamjeom || 0;
  if (blueGamjeom !== redGamjeom) {
    if (blueGamjeom < redGamjeom) {
      state.blueSupLead = redGamjeom - blueGamjeom;
      state.redSupLead = 0;
    } else {
      state.blueSupLead = 0;
      state.redSupLead = blueGamjeom - redGamjeom;
    }
    return;
  }

  // Tier 5: Dead tie
  state.blueSupLead = 0;
  state.redSupLead = 0;
}

function checkConsensus(judgeIndex, color, points) {
  const now = Date.now();
  
  // Safe init if dynamic points
  if (!judgePresses[color][points]) {
    judgePresses[color][points] = { 1: 0, 2: 0, 3: 0 };
  }
  if (!consumedPresses[color][points]) {
    consumedPresses[color][points] = { 1: false, 2: false, 3: false };
  }
  
  judgePresses[color][points][judgeIndex] = now;
  consumedPresses[color][points][judgeIndex] = false; // Fresh unconsumed press
  
  // Check lockout window (prevent double-hitting the same target/kick)
  const lastScore = lastScoreTime[color];
  if (now - lastScore < state.pointLockoutTime * 1000) {
    logEvent(`Lockout active for ${color.toUpperCase()} (${((state.pointLockoutTime * 1000 - (now - lastScore))/1000).toFixed(1)}s left). Input ignored.`);
    return;
  }
  
  // Look for another unconsumed press from another judge within the time window
  const windowMs = state.consensusWindow * 1000;
  let matchingJudges = [judgeIndex];
  
  for (let i = 1; i <= 3; i++) {
    if (i === judgeIndex) continue;
    
    const pressTime = judgePresses[color][points][i];
    const isConsumed = consumedPresses[color][points][i];
    
    if (pressTime > 0 && !isConsumed && (now - pressTime <= windowMs)) {
      matchingJudges.push(i);
    }
  }
  
  // Consensus reached if matching judges reach required threshold (default 1 for instant response)
  const requiredJudges = Math.max(1, state.minConsensusJudges !== undefined ? state.minConsensusJudges : 1);
  if (matchingJudges.length >= requiredJudges) {
    // Award score points and confirmed registered hit
    state[`${color}Score`] += points;
    state[`${color}Hits`]++;
    
    // Track technical categories for WT Superiority
    if (points === 4 || points === 5) {
      state[`${color}Turning`] = (state[`${color}Turning`] || 0) + 1;
    }
    if (points === 3 || points === 5) {
      state[`${color}Head`] = (state[`${color}Head`] || 0) + 1;
    }

    // Mark these judge inputs as consumed
    matchingJudges.forEach(jIdx => {
      consumedPresses[color][points][jIdx] = true;
    });
    
    // Set lockout timestamp
    lastScoreTime[color] = now;
    
    // Recalculate WT Superiority
    updateSuperiorityLead();

    let pointDesc = `+${points}pt`;
    if (points === 4) pointDesc = "中端轉身 +4pt 🌀";
    else if (points === 5) pointDesc = "上端轉身 +5pt 🌀";
    else if (points === 3) pointDesc = "上端頭部 +3pt";
    else if (points === 2) pointDesc = "中端軀幹 +2pt";
    else if (points === 1) pointDesc = "拳擊 +1pt";
    
    logEvent(`Consensus Reached (${color.toUpperCase()} ${pointDesc}) by Judges [${matchingJudges.join(',')}]. Awarded +${points} points!`);
    broadcastSound("point");
  }
}

// Timer management
let lastHeartbeatTime = 0;

function toggleTimer() {
  if (state.timerRunning) {
    // Pause
    state.timerRunning = false;
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    if (state.timerEndTime) {
      state.currentTime = Math.max(0, Math.round((state.timerEndTime - Date.now()) / 100) / 10);
      state.timerEndTime = null;
    }
    state.timestamp = Date.now();
    logEvent("Timer Paused");
    renderControlDOM();
    broadcastState();
  } else {
    // Play
    initAudio(); // Warm up audio context
    state.timerRunning = true;
    state.timerEndTime = Date.now() + Math.round(state.currentTime * 1000);
    state.timestamp = Date.now();
    
    startControlTimer();
    
    logEvent(`Timer Started (${state.isRest ? 'REST' : 'MATCH'} period)`);
    renderControlDOM();
    broadcastState();
  }
}

function startControlTimer() {
  if (timerInterval) clearInterval(timerInterval);
  lastHeartbeatTime = Date.now();
  
  timerInterval = setInterval(() => {
    if (!state.timerRunning || !state.timerEndTime) {
      clearInterval(timerInterval);
      timerInterval = null;
      return;
    }
    
    const remainingMs = state.timerEndTime - Date.now();
    if (remainingMs <= 30) {
      state.currentTime = 0;
      state.timerRunning = false;
      state.timerEndTime = null;
      state.timestamp = Date.now();
      clearInterval(timerInterval);
      timerInterval = null;
      
      // Round / rest period completed
      broadcastSound("buzzer");
      handlePeriodEnd();
      renderControlDOM();
      broadcastState();
    } else {
      state.currentTime = Math.max(0, Math.round(remainingMs / 100) / 10);
      const timerElem = document.getElementById("ctrl-timer-time");
      if (timerElem) timerElem.textContent = formatTime(state.currentTime);
      
      // Low-frequency heartbeat (every 1 second) to keep remote devices aligned without spamming network
      const now = Date.now();
      if (now - lastHeartbeatTime >= 1000) {
        lastHeartbeatTime = now;
        state.timestamp = now;
        channel.postMessage({ type: "STATE_UPDATE", state: state });
        try {
          localStorage.setItem("tkd_state", JSON.stringify(state));
        } catch (e) {}
      }
    }
  }, 50);
}

function handlePeriodEnd() {
  if (state.isRest) {
    // Rest ended, prepare next round
    state.isRest = false;
    state.currentRound++;
    state.currentTime = state.roundDuration;
    
    // Reset round scores in Best of 3 mode
    if (state.scoringMode === "bestOf3") {
      state.blueScore = 0;
      state.blueGamjeom = 0;
      state.blueHits = 0;
      state.blueTurning = 0;
      state.blueHead = 0;
      state.blueSupLead = 0;
      state.redScore = 0;
      state.redGamjeom = 0;
      state.redHits = 0;
      state.redTurning = 0;
      state.redHead = 0;
      state.redSupLead = 0;
    }
    
    logEvent(`Rest completed. Starting Round ${state.currentRound}`);
  } else {
    // Round ended, transition to rest
    logEvent(`Round ${state.currentRound} finished.`);
    
    // Decide winner automatically if bestOf3 mode
    let roundWinner = null;
    if (state.scoringMode === "bestOf3") {
      let winnerText = "";
      if (roundEndedByPenalty) {
        const winnerColor = roundEndedByPenalty;
        roundWinner = winnerColor;
        state[`${winnerColor}Wins`]++;
        winnerText = `${state[`${winnerColor}Name`] || (winnerColor === "blue" ? "藍方" : "紅方")} (${winnerColor === "blue" ? "Blue" : "Red"}) wins Round ${state.currentRound} by penalty!`;
        logEvent(winnerText);
        roundEndedByPenalty = null; // Clear the flag
      } else {
        const blueDisplayName = state.blueName || "藍方";
        const redDisplayName = state.redName || "紅方";

        if (state.blueScore > state.redScore) {
          roundWinner = "blue";
          state.blueWins++;
          winnerText = `${blueDisplayName} (Blue) wins Round ${state.currentRound}`;
          logEvent(`${winnerText} [Score: ${state.blueScore} - ${state.redScore}]`);
        } else if (state.redScore > state.blueScore) {
          roundWinner = "red";
          state.redWins++;
          winnerText = `${redDisplayName} (Red) wins Round ${state.currentRound}`;
          logEvent(`${winnerText} [Score: ${state.blueScore} - ${state.redScore}]`);
        } else {
          // Tie score - Resolve by WT Superiority criteria
          updateSuperiorityLead();

          if (state.blueSupLead > state.redSupLead) {
            roundWinner = "blue";
            state.blueWins++;
            winnerText = `${blueDisplayName} (Blue) wins Round ${state.currentRound} by WT Superiority (優勢判定勝)!`;
            logEvent(`${winnerText} [Tied Score: ${state.blueScore}-${state.redScore}, Sup Lead: +${state.blueSupLead}]`);
          } else if (state.redSupLead > state.blueSupLead) {
            roundWinner = "red";
            state.redWins++;
            winnerText = `${redDisplayName} (Red) wins Round ${state.currentRound} by WT Superiority (優勢判定勝)!`;
            logEvent(`${winnerText} [Tied Score: ${state.blueScore}-${state.redScore}, Sup Lead: +${state.redSupLead}]`);
          } else {
            winnerText = `Round ${state.currentRound} is a dead TIE (平手且優勢判定相同). Please manually award the round win.`;
            logEvent(winnerText);
          }
        }
      }

      // Record round score
      if (!state.roundScores) {
        state.roundScores = [
          { blue: null, red: null, winner: null },
          { blue: null, red: null, winner: null },
          { blue: null, red: null, winner: null }
        ];
      }
      const rIdx = state.currentRound - 1;
      state.roundScores[rIdx] = {
        blue: state.blueScore,
        red: state.redScore,
        winner: roundWinner
      };
      
      // Check if match won
      if (state.blueWins >= 2 || state.redWins >= 2) {
        state.matchOver = true;
        const winner = state.blueWins >= 2 ? (state.blueName || '藍方') : (state.redName || '紅方');
        const color = state.blueWins >= 2 ? 'BLUE' : 'RED';
        logEvent(`MATCH OVER! Winner: ${winner} (${color})`);
      }
    }
    
    // If match is over, stop timer completely and do not run rest countdown
    if (state.matchOver || (state.scoringMode === "totalScore" && state.currentRound >= 3)) {
      state.matchOver = true;
      state.isRest = true;
      state.currentTime = 0;
      state.timerRunning = false;
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      state.timerEndTime = null;
    } else {
      // Normal between-round rest
      state.isRest = true;
      state.currentTime = state.restDuration;
    }
  }
}

function adjustTimer(secs) {
  state.currentTime = Math.max(0, Math.round((state.currentTime + secs) * 10) / 10);
  if (state.timerRunning && state.timerEndTime) {
    state.timerEndTime += secs * 1000;
  }
  state.timestamp = Date.now();
  logEvent(`Timer adjusted by ${secs}s. New time: ${formatTime(state.currentTime)}`);
  renderControlDOM();
  broadcastState();
}

function applySettings(e) {
  if (e) e.preventDefault();
  
  state.matchId = document.getElementById("cfg-match-id").value;
  state.matchClass = document.getElementById("cfg-match-class").value;
  
  state.blueName = document.getElementById("cfg-blue-name").value;
  state.blueTeam = document.getElementById("cfg-blue-team").value;
  
  state.redName = document.getElementById("cfg-red-name").value;
  state.redTeam = document.getElementById("cfg-red-team").value;
  
  state.scoringMode = document.getElementById("cfg-score-mode").value;
  state.roundDuration = parseInt(document.getElementById("cfg-round-duration").value);
  state.restDuration = parseInt(document.getElementById("cfg-rest-duration").value);
  
  const consensusWinEl = document.getElementById("cfg-consensus-window");
  if (consensusWinEl) state.consensusWindow = parseFloat(consensusWinEl.value);
  const minJudgesEl = document.getElementById("cfg-min-judges");
  if (minJudgesEl) state.minConsensusJudges = parseInt(minJudgesEl.value) || 1;
  const pointsHitEl = document.getElementById("cfg-points-hit");
  if (pointsHitEl) state.pointsPerHit = parseInt(pointsHitEl.value) || 2;
  const lockoutEl = document.getElementById("cfg-lockout-time");
  if (lockoutEl) state.pointLockoutTime = parseFloat(lockoutEl.value) || 1.5;
  
  // Custom Keyboard mappings
  state.keys.j1Blue = document.getElementById("cfg-key-j1b").value;
  state.keys.j1Red = document.getElementById("cfg-key-j1r").value;
  state.keys.j2Blue = document.getElementById("cfg-key-j2b").value;
  state.keys.j2Red = document.getElementById("cfg-key-j2r").value;
  state.keys.j3Blue = document.getElementById("cfg-key-j3b").value;
  state.keys.j3Red = document.getElementById("cfg-key-j3r").value;

  // If timer not running, update current clock
  if (!state.timerRunning && !state.isRest) {
    state.currentTime = state.roundDuration;
  }
  state.timestamp = Date.now();

  logEvent("Settings applied and synced.");
  renderControlDOM();
  broadcastState();
}

function resetMatchFully() {
  if (confirm("Are you sure you want to reset the entire match? This clears all scores, penalties, and wins!")) {
    state.blueScore = 0;
    state.blueGamjeom = 0;
    state.blueHits = 0;
    state.blueTurning = 0;
    state.blueHead = 0;
    state.blueSupLead = 0;
    state.blueReplay = 1;
    state.blueWins = 0;
    
    state.redScore = 0;
    state.redGamjeom = 0;
    state.redHits = 0;
    state.redTurning = 0;
    state.redHead = 0;
    state.redSupLead = 0;
    state.redReplay = 1;
    state.redWins = 0;
    
    state.currentRound = 1;
    state.currentTime = state.roundDuration;
    state.isRest = false;
    state.matchOver = false;
    state.roundScores = [
      { blue: null, red: null, winner: null },
      { blue: null, red: null, winner: null },
      { blue: null, red: null, winner: null }
    ];
    if (state.timerRunning) {
      state.timerRunning = false;
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
    }
    state.timerEndTime = null;
    state.timestamp = Date.now();
    
    // Clear judge records for points 1-5
    judgePresses = {
      blue: {
        1: { 1: 0, 2: 0, 3: 0 },
        2: { 1: 0, 2: 0, 3: 0 },
        3: { 1: 0, 2: 0, 3: 0 },
        4: { 1: 0, 2: 0, 3: 0 },
        5: { 1: 0, 2: 0, 3: 0 }
      },
      red: {
        1: { 1: 0, 2: 0, 3: 0 },
        2: { 1: 0, 2: 0, 3: 0 },
        3: { 1: 0, 2: 0, 3: 0 },
        4: { 1: 0, 2: 0, 3: 0 },
        5: { 1: 0, 2: 0, 3: 0 }
      }
    };
    
    consumedPresses = {
      blue: {
        1: { 1: false, 2: false, 3: false },
        2: { 1: false, 2: false, 3: false },
        3: { 1: false, 2: false, 3: false },
        4: { 1: false, 2: false, 3: false },
        5: { 1: false, 2: false, 3: false }
      },
      red: {
        1: { 1: false, 2: false, 3: false },
        2: { 1: false, 2: false, 3: false },
        3: { 1: false, 2: false, 3: false },
        4: { 1: false, 2: false, 3: false },
        5: { 1: false, 2: false, 3: false }
      }
    };
    
    logEvent("Match fully reset.");
    renderControlDOM();
    broadcastState();
  }
}

function forceEndPeriod() {
  if (state.timerRunning) {
    state.timerRunning = false;
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }
  state.timerEndTime = null;
  state.timestamp = Date.now();
  
  if (state.isRest) {
    // Skip Rest and start next round
    state.isRest = false;
    state.currentRound++;
    state.currentTime = state.roundDuration;
    
    // Reset round scores in Best of 3 mode
    if (state.scoringMode === "bestOf3") {
      state.blueScore = 0;
      state.blueGamjeom = 0;
      state.blueHits = 0;
      state.blueTurning = 0;
      state.blueHead = 0;
      state.blueSupLead = 0;
      state.redScore = 0;
      state.redGamjeom = 0;
      state.redHits = 0;
      state.redTurning = 0;
      state.redHead = 0;
      state.redSupLead = 0;
    }
    logEvent(`Skipped rest. Manually started Round ${state.currentRound}`);
  } else {
    // Force end current round
    state.currentTime = 0;
    broadcastSound("buzzer");
    handlePeriodEnd();
  }
  
  renderControlDOM();
  broadcastState();
}

function syncControlForm() {
  document.getElementById("cfg-match-id").value = state.matchId;
  document.getElementById("cfg-match-class").value = state.matchClass;
  
  document.getElementById("cfg-blue-name").value = state.blueName;
  document.getElementById("cfg-blue-team").value = state.blueTeam;
  
  document.getElementById("cfg-red-name").value = state.redName;
  document.getElementById("cfg-red-team").value = state.redTeam;
  
  document.getElementById("cfg-score-mode").value = state.scoringMode;
  document.getElementById("cfg-max-gamjeoms").value = state.maxGamjeoms;
  document.getElementById("cfg-round-duration").value = state.roundDuration;
  document.getElementById("cfg-rest-duration").value = state.restDuration;
  
  const consensusWinEl = document.getElementById("cfg-consensus-window");
  if (consensusWinEl) consensusWinEl.value = state.consensusWindow;
  const minJudgesEl = document.getElementById("cfg-min-judges");
  if (minJudgesEl) minJudgesEl.value = state.minConsensusJudges || 1;
  const pointsHitEl = document.getElementById("cfg-points-hit");
  if (pointsHitEl) pointsHitEl.value = state.pointsPerHit || 2;
  const lockoutEl = document.getElementById("cfg-lockout-time");
  if (lockoutEl) lockoutEl.value = state.pointLockoutTime || 1.5;

  document.getElementById("cfg-key-j1b").value = state.keys.j1Blue;
  document.getElementById("cfg-key-j1r").value = state.keys.j1Red;
  document.getElementById("cfg-key-j2b").value = state.keys.j2Blue;
  document.getElementById("cfg-key-j2r").value = state.keys.j2Red;
  document.getElementById("cfg-key-j3b").value = state.keys.j3Blue;
  document.getElementById("cfg-key-j3r").value = state.keys.j3Red;
}

function renderControlDOM() {
  // Center Control Display
  document.getElementById("ctrl-match-badge").textContent = state.matchId 
    ? `${state.matchId} - R${state.currentRound} ${state.isRest ? 'REST' : 'MATCH'}`
    : `R${state.currentRound} ${state.isRest ? 'REST' : 'MATCH'}`;
  document.getElementById("ctrl-timer-time").textContent = formatTime(state.currentTime);
  
  // Active Timer Play Button Label
  const toggleBtn = document.getElementById("btn-timer-toggle");
  if (state.timerRunning) {
    toggleBtn.textContent = "PAUSE (Space)";
    toggleBtn.className = "btn-primary btn-timer-play timer-running";
  } else {
    toggleBtn.textContent = "START (Space)";
    toggleBtn.className = "btn-primary btn-timer-play";
  }

  // Next Round / End Round button text
  const nextBtn = document.getElementById("btn-next-round");
  if (state.isRest) {
    nextBtn.textContent = "跳過休息 / 開始下一局 (Skip Rest)";
  } else {
    nextBtn.textContent = "強制結束本局 (End Round)";
  }

  // Competitor Card details
  document.getElementById("ctrl-blue-card-title").textContent = state.blueName || "藍方";
  document.getElementById("ctrl-blue-card-sub").textContent = state.blueTeam || "";
  document.getElementById("ctrl-blue-score-val").textContent = state.blueScore;
  document.getElementById("ctrl-blue-gamjeom-val").textContent = state.blueGamjeom;
  document.getElementById("ctrl-blue-hits-val").textContent = state.blueHits;
  document.getElementById("ctrl-blue-wins-val").textContent = state.blueWins;
  const blueTurningElem = document.getElementById("ctrl-blue-turning-val");
  if (blueTurningElem) blueTurningElem.textContent = state.blueTurning || 0;
  const blueSupLeadElem = document.getElementById("ctrl-blue-suplead-val");
  if (blueSupLeadElem) blueSupLeadElem.textContent = state.blueSupLead || 0;

  document.getElementById("ctrl-red-card-title").textContent = state.redName || "紅方";
  document.getElementById("ctrl-red-card-sub").textContent = state.redTeam || "";
  document.getElementById("ctrl-red-score-val").textContent = state.redScore;
  document.getElementById("ctrl-red-gamjeom-val").textContent = state.redGamjeom;
  document.getElementById("ctrl-red-hits-val").textContent = state.redHits;
  document.getElementById("ctrl-red-wins-val").textContent = state.redWins;
  const redTurningElem = document.getElementById("ctrl-red-turning-val");
  if (redTurningElem) redTurningElem.textContent = state.redTurning || 0;
  const redSupLeadElem = document.getElementById("ctrl-red-suplead-val");
  if (redSupLeadElem) redSupLeadElem.textContent = state.redSupLead || 0;

  // Keyboard mapping descriptions
  document.getElementById("lbl-j1b-map").textContent = state.keys.j1Blue.toUpperCase();
  document.getElementById("lbl-j1r-map").textContent = state.keys.j1Red.toUpperCase();
  document.getElementById("lbl-j2b-map").textContent = state.keys.j2Blue.toUpperCase();
  document.getElementById("lbl-j2r-map").textContent = state.keys.j2Red.toUpperCase();
  document.getElementById("lbl-j3b-map").textContent = state.keys.j3Blue.toUpperCase();
  document.getElementById("lbl-j3r-map").textContent = state.keys.j3Red.toUpperCase();

  // Render Sub-Round breakdown in Control Panel as well
  renderRoundHistoryDOM();
}

function setupAdjustmentButtons() {
  const sides = ["blue", "red"];
  const stats = ["score", "gamjeom", "hits", "turning", "wins"];
  
  sides.forEach(color => {
    stats.forEach(stat => {
      const plusBtn = document.getElementById(`btn-${color}-${stat}-plus`);
      const minusBtn = document.getElementById(`btn-${color}-${stat}-minus`);

      if (plusBtn) {
        plusBtn.onclick = () => {
          if (stat === "gamjeom") {
            state[`${color}Gamjeom`]++;
            // Gam-jeom rule: Adds 1 point to opponent score
            const opponent = color === "blue" ? "red" : "blue";
            state[`${opponent}Score`]++;
            
            logEvent(`Gam-jeom penalty to ${color.toUpperCase()}. Opponent ${opponent.toUpperCase()} +1 point. Total Gam-jeom: ${state[`${color}Gamjeom`]}`);
            broadcastSound("gamjeom");
            
            // Reaching maximum Gam-jeoms in a round triggers automatic round loss
            if (state[`${color}Gamjeom`] >= state.maxGamjeoms && state.scoringMode === "bestOf3") {
              logEvent(`${color.toUpperCase()} reached ${state.maxGamjeoms} Gam-jeoms! Lost round.`);
              alert(`${color.toUpperCase()} reached ${state.maxGamjeoms} Gam-jeoms! Opponent wins this round.`);
              roundEndedByPenalty = opponent;
              forceEndPeriod(); // Automatically transitions to rest
            }
          } else {
            state[`${color}${capitalizeFirst(stat)}`]++;
            logEvent(`Manual adjust: ${color.toUpperCase()} ${stat} +1`);
            if (stat === "wins") {
              state.matchOver = state.scoringMode === "bestOf3" && (state.blueWins >= 2 || state.redWins >= 2);
            }
          }
          updateSuperiorityLead();
          renderControlDOM();
          broadcastState();
        };
      }
      
      if (minusBtn) {
        minusBtn.onclick = () => {
          if (stat === "gamjeom") {
            if (state[`${color}Gamjeom`] > 0) {
              state[`${color}Gamjeom`]--;
              // Remove the point added to opponent as well
              const opponent = color === "blue" ? "red" : "blue";
              if (state[`${opponent}Score`] > 0) {
                state[`${opponent}Score`]--;
              }
              logEvent(`Manual adjust: Removed Gam-jeom penalty from ${color.toUpperCase()}. Opponent ${opponent.toUpperCase()} -1 point.`);
            }
          } else {
            if (state[`${color}${capitalizeFirst(stat)}`] > 0) {
              state[`${color}${capitalizeFirst(stat)}`]--;
              logEvent(`Manual adjust: ${color.toUpperCase()} ${stat} -1`);
              if (stat === "wins") {
                state.matchOver = state.scoringMode === "bestOf3" && (state.blueWins >= 2 || state.redWins >= 2);
              }
            }
          }
          updateSuperiorityLead();
          renderControlDOM();
          broadcastState();
        };
      }
    });
  });
}

function capitalizeFirst(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

// Window load route trigger
window.addEventListener("DOMContentLoaded", route);
window.addEventListener("hashchange", route);
window.addEventListener("click", () => {
  // Some browsers block AudioContext from starting without a user gesture click.
  // This listener safely initializes on the first click in either window.
  initAudio();
});
