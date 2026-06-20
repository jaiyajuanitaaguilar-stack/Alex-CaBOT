const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "players.json");
const LOG_PATH = path.join(__dirname, "errors.log");

// Synchronous load at startup so the rest of the app can use `players` synchronously.
function loadPlayers() {
  try {
    if (!fs.existsSync(DATA_PATH)) {
      fs.writeFileSync(DATA_PATH, "{}", "utf8");
    }
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("playerStore: failed to load players:", err);
    appendLog(`load failed: ${err && err.message}`);
    return {};
  }
}

function appendLog(line) {
  const entry = `${new Date().toISOString()} ${line}\n`; 
  console.error(`playerStore: ${line}`); 
  fs.promises.appendFile(LOG_PATH, entry, "utf8").catch((err) => {
    console.error(`playerStore: failed to write log: ${err && err.message}`);
  });
}

// In-process serialization of saves to avoid races.
let lastSave = Promise.resolve();

async function savePlayers(players) {
  // queue the save so concurrent calls are serialized
  lastSave = lastSave.then(() => performSave(players)).catch(() => performSave(players)); 
  return lastSave;
}

async function performSave(players) {
  const tmpPath = DATA_PATH + ".tmp";
  let data;
  try {
    data = JSON.stringify(players, null, 2);
  } catch (err) {
    const msg = `serialize failed: ${err && err.message}`;
    console.error(`playerStore: ${msg}`);
    appendLog(msg);
    return;
  }

  try {
    await fs.promises.writeFile(tmpPath, data, "utf8");
  } catch (err) {
    const msg = `write failed: ${err && err.message}`;
    console.error(`playerStore: ${msg}`);
    appendLog(msg);
    try { await fs.promises.unlink(tmpPath); } catch (_) {}
    return;
  }

  try {
    await fs.promises.rename(tmpPath, DATA_PATH);
  } catch (err) {
    // try unlink + retry (helps on some Windows setups)
    try {
      await fs.promises.unlink(DATA_PATH).catch(() => {});
      await fs.promises.rename(tmpPath, DATA_PATH);
    } catch (finalErr) {
      const msg = `rename failed: ${(finalErr && finalErr.message) || (err && err.message)}`;
      console.error(`playerStore: ${msg}`);
      appendLog(msg);
      try { await fs.promises.unlink(tmpPath); } catch (_) {}
      return;
    }
  }
  // success log
  appendLog("save ok");
}

module.exports = { loadPlayers, savePlayers };