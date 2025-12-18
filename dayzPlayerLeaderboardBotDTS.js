const Discord = require("discord.js");
const client = new Discord.Client();
const cron = require("node-cron");

const GHOST_FILE = "./ghostLeader.json";

const basicFTP = require("basic-ftp");
const { enterPassiveModeIPv4 } = basicFTP;

const fs = require("fs");
const settings = require("./settings.json");
const LEADERBOARD_CHANNEL_ID = settings.LEADERBOARD_CHANNEL_ID;
const Player = require("./Player.js");

const ftp = new basicFTP.Client();

// ================= CONFIG =================

const ADMINS = ["fox", "hadoukendts"];

const FTP_PATH = ["172.84.94.147_2382", "profiles", "Leaderboard"];

let fileInfos = [];
let players = [];
let position = 1;

// ================= DISCORD =================

client.on("ready", () => {
  console.log("Connected as " + client.user.tag);
  cron.schedule(
    "0 7 * * *",
    () => {
      console.log("⏰ Enviando leaderboard diário...");
      sendDailyLeaderboard(client);
    },
    {
      timezone: "America/Sao_Paulo"
    }
  );
});

client.on("message", async (msg) => {
  if (msg.author.bot) return;
  if (!msg.content.startsWith("!")) return;

  const args = msg.content.slice(1).split(" ");
  const cmd = args.shift().toLowerCase();

  switch (cmd) {
    case "help":
      sendHelp(msg);
      break;
    case "leaderboard":
      await leaderboardCommand(msg);
      break;
    case "player":
      await playerCommand(msg, args);
      break;
    default:
      msg.channel.send("Comando inválido. Use `!help`");
  }
});

// ================= HELP =================

function sendHelp(msg) {
  msg.channel.send(
`📊 **Comandos disponíveis**

!leaderboard  
→ Ranking geral de sobrevivência

!player <nome>  
→ Estatísticas detalhadas do jogador

🔐 **Admins (${ADMINS.join(", ")}) veem:**
• Localização da última morte

👥 **Usuários comuns NÃO veem localização**

Badges:
👑 Top sobrevivente
🧟 Slayer (zumbis)
🐺 Caçador (animais)
🛡️ Imortal (0 mortes)
`
  );
}

// ================= FTP =================

async function loadFiles() {
  fileInfos = [];
  players = [];

  ftp.prepareTransfer = enterPassiveModeIPv4;

  await ftp.access({
    host: settings.ftpHost,
    port: settings.ftpPort,
    user: settings.ftpUser,
    password: settings.ftpPass,
    secure: false
  });

  for (const dir of FTP_PATH) await ftp.cd(dir);

  if (!fs.existsSync("./playerJsons")) fs.mkdirSync("./playerJsons");

  const list = await ftp.list();
  for (const file of list) {
    if (file.name.endsWith(".json")) {
      fileInfos.push(file.name);
    }
  }

  await ftp.downloadToDir("./playerJsons");
  ftp.close();

  fileInfos.forEach(loadPlayer);
}

function loadPlayer(file) {
  const raw = fs.readFileSync("./playerJsons/" + file);
  const data = JSON.parse(raw);

  const p = new Player(
    data.name,
    data.deaths || [],
    data.kills || [],
    data.longestShot || 0,
    data.zKilled || 0,
    data.timeSurvived || 0,
    data.distTrav || 0
  );

  if (data.lastTimeSeen) {
    p.lastSeen = parseDayZDate(data.lastTimeSeen);
  } else if (data.deaths?.length) {
    // fallback: última morte
    const lastDeath = data.deaths[data.deaths.length - 1];
    p.lastSeen = parseDayZDate(lastDeath.timeStamp);
  } else {
    p.lastSeen = null;
  }
  
  p.animalsKilled = data.animalsKilled || [];
  p.deathsRaw = data.deaths || [];

  players.push(p);
}

function parseDayZDate(str) {
  if (!str) return null;

  // esperado: YYYY-MM-DD H:m:s
  const [datePart, timePart] = str.split(" ");
  if (!datePart || !timePart) return null;

  let [y, m, d] = datePart.split("-").map(Number);
  let [h, min, s] = timePart.split(":").map(Number);

  if ([y, m, d, h, min, s].some(isNaN)) return null;

  return new Date(y, m - 1, d, h, min, s);
}

function loadGhostLeader() {
  if (!fs.existsSync(GHOST_FILE)) {
    fs.writeFileSync(
      GHOST_FILE,
      JSON.stringify({ name: null, dist: 0, timeSurvived: 0, date: null }, null, 2)
    );
  }
  return JSON.parse(fs.readFileSync(GHOST_FILE));
}

function saveGhostLeader(data) {
  fs.writeFileSync(GHOST_FILE, JSON.stringify(data, null, 2));
}


// ================= COMMANDS =================

// async function leaderboardCommand(msg) {
//   await loadFiles();

//   players.sort((a, b) => b.timeSurvived - a.timeSurvived);
//   position = 1;

//   msg.channel.send(
//     "Descrição: ⏱️ tempo | 🏃 distância | 🙍‍♂🧟 kills (player/zumbi) | 🐺 animais | ⌚ visto por último"
//   );

//   players.forEach(p => {
//     const isAdmin = ADMINS.includes(p.name.toLowerCase());

//     const badges = getBadges(p);
//     const line =
//       `${isAdmin ? "[adm]" : "[" + position + "]"} ${p.name} ` +
//       `⏱️${fmtTime(p.timeSurvived)} ` +
//       `🏃${km(p.distTraveled)}km ` +
//       `🙍‍♂${p.playerKills.length}🧟${p.zedKills} 🐺${p.animalsKilled.length} ☠️${p.deaths.length} ` +
//       `⌚ ${fmtDate(p.lastSeen)} ${badges}`;

//     msg.channel.send(line);

//     if (!isAdmin) position++;
//   });
// }

function updateGhostLeader(players) {
  const ghost = loadGhostLeader();

  players.forEach(p => {
    if (p.distTraveled > ghost.dist) {
      ghost.name = p.name;
      ghost.dist = p.distTraveled;
      ghost.timeSurvived = p.timeSurvived;
      ghost.date = new Date().toISOString();
    }
  });

  saveGhostLeader(ghost);
  return ghost;
}
async function sendDailyLeaderboard(client) {
  await loadFiles();

  const ghost = updateGhostLeader(players);

  players.sort((a, b) => b.timeSurvived - a.timeSurvived);
  position = 1;

  const lines = [];

  lines.push(
    "Descrição: ⏱️ tempo | 🏃 km | 🙍‍♂/🧟 kills | 🐺 animais | ⌚ visto"
  );
  lines.push("");

  if (ghost.name) {
    lines.push(
      `[#]   GHOST LEADER`
    );
    lines.push(
      `[0]   ${pad(ghost.name, 22)} ` +
      `${pad(`🏃${km(ghost.dist)}km`, 12)} ` +
      `${pad(`⏱️${fmtTime(ghost.timeSurvived)}`, 14)} ` +
      `👻 recorde histórico`
    );
    lines.push("");
  }

  players.forEach(p => {
    const isAdmin = ADMINS.includes(p.name.toLowerCase());
    const rank = isAdmin ? "[adm]" : `[${position}]`;

    const line =
      `${pad(rank, 6)} ` +
      `${pad(p.name, 22)} ` +
      `${pad(`⏱️${fmtTime(p.timeSurvived)}`, 12)} ` +
      `${pad(`🏃${km(p.distTraveled)}km`, 9)} ` +
      `${pad(`🙍‍♂${p.playerKills.length}/🧟${p.zedKills}`, 14)} ` +
      `${pad(`🐺${p.animalsKilled.length}`, 6)} ` +
      //`${pad(`☠️${p.deaths.length}`, 6)} ` +
      `⌚${fmtDate(p.lastSeen)}`;

    lines.push(line);

    if (!isAdmin) position++;
  });

  const channel = client.channels.cache.get(LEADERBOARD_CHANNEL_ID);
  if (!channel) {
    console.error("Canal de leaderboard não encontrado");
    return;
  }

  channel.send("```txt\n" + lines.join("\n") + "\n```");
}

async function leaderboardCommand(msg) {
  await loadFiles();
  const ghost = updateGhostLeader(players);

  players.sort((a, b) => b.timeSurvived - a.timeSurvived);
  position = 1;

  const lines = [];

  lines.push(
    "Descrição: ⏱️ tempo | 🏃 km | 🙍‍♂/🧟 kills | 🐺 animais | ☠️ mortes | ⌚ visto"
  );
  lines.push("");

  if (ghost.name) {
    lines.push(
      `[#]   GHOST LEADER`
    );
    lines.push(
      `[0]   ${pad(ghost.name, 22)} ` +
      `${pad(`🏃${km(ghost.dist)}km`, 12)} ` +
      `${pad(`⏱️${fmtTime(ghost.timeSurvived)}`, 14)} ` +
      `👻 recorde histórico`
    );
    lines.push("");
  }


  players.forEach(p => {
    const isAdmin = ADMINS.includes(p.name.toLowerCase());
    const rank = isAdmin ? "[adm]" : `[${position}]`;

    const line =
      `${pad(rank, 6)} ` +
      `${pad(p.name, 22)} ` +
      `${pad(`⏱️${fmtTime(p.timeSurvived)}`, 12)} ` +
      `${pad(`🏃${km(p.distTraveled)}km`, 9)} ` +
      `${pad(`🙍‍♂${p.playerKills.length}/🧟${p.zedKills}`, 14)} ` +
      `${pad(`🐺${p.animalsKilled.length}`, 6)} ` +
      `${pad(`☠️${p.deaths.length}`, 6)} ` +
      `⌚${fmtDate(p.lastSeen)}`;

    lines.push(line);

    if (!isAdmin) position++;
  });

  msg.channel.send("```txt\n" + lines.join("\n") + "\n```");
}


async function playerCommand(msg, args) {
  if (!args.length) {
    msg.channel.send("Use: `!player <nome>`");
    return;
  }

  await loadFiles();

  const name = args.join(" ").toLowerCase();
  const p = players.find(x => x.name.toLowerCase() === name);

  if (!p) {
    msg.channel.send("Jogador não encontrado.");
    return;
  }

  const isAdmin = ADMINS.includes(msg.author.username.toLowerCase());

  let text =
`📄 **${p.name}**
⏱️ Total vivo: ${fmtTime(p.timeSurvived)}
☠️ Mortes: ${p.deaths.length}
🙍‍♂ Kills players: ${p.playerKills.length}
🧟 Zumbis mortos: ${p.zedKills}
🐺 Animais mortos: ${p.animalsKilled.length}
🏃 Distância: ${km(p.distTraveled)}km
⌚ Visto por último: ${fmtDate(p.lastSeen)}
${getBadges(p)}
`;

  if (isAdmin && p.deathsRaw.length) {
    const lastDeath = p.deathsRaw[p.deathsRaw.length - 1];
    text += `📍 Última morte: ${lastDeath.posDeath}\n`;
  }

  msg.channel.send(text);
}

// ================= BADGES =================

function getBadges(p) {
  let badges = "";

  if (p.zedKills >= 200) badges += " 🧟 Slayer";
  if (p.animalsKilled.length >= 10) badges += " 🐺 Caçador";
  if (p.deaths.length === 0) badges += " 🛡️ Imortal";
  if (p.timeSurvived === Math.max(...players.map(x => x.timeSurvived)))
    badges += " 👑";

  return badges;
}

function pad(text, size) {
  return String(text).padEnd(size, " ");
}


// ================= HELPERS =================

function fmtTime(sec) {
  let d = Math.floor(sec / 86400);
  sec %= 86400;
  let h = Math.floor(sec / 3600);
  let m = Math.floor((sec % 3600) / 60);
  return `${d}d${h.toString().padStart(2,"0")}h${m.toString().padStart(2,"0")}m`;
}

function km(m) {
  return Math.round(m / 1000);
}

function fmtDate(d) {
  return d.toLocaleDateString("pt-BR");
}

// ================= LOGIN =================

client.login(settings.token);
