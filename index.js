const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require("discord.js");

const TOKEN = process.env.TOKEN;

// how much libido is removed each minute (adjust as needed)
const LIBIDO_DECAY_PER_MIN = 1;
// interval in milliseconds
const LIBIDO_DECAY_INTERVAL_MS = 60_000;

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// per-channel monster storage (keyed by channel id)
const monsters = {};

// helpers for channel-scoped monster access
function getMonster(channelId) {
    return monsters[channelId] ?? null;
}

function setMonster(channelId, monsterObj) {
    monsters[channelId] = monsterObj;
}

function clearMonster(channelId) {
    stopLibidoDecay(channelId);
    delete monsters[channelId];
}

// start periodic libido decay for a monster (no-op if monster has no libido)
function startLibidoDecay(channelId) {
    const m = getMonster(channelId);
    if (!m || typeof m.maxLibido === "undefined") return;
    if (m._decayTimer) return;

    m._decayTimer = setInterval(async () => {
        const current = getMonster(channelId);
        if (!current) {
            // monster removed elsewhere; ensure timer cleared
            clearInterval(m._decayTimer);
            return;
        }

        // decrease libido but don't go below 0
        current.libido = Math.max(0, (current.libido ?? 0) - LIBIDO_DECAY_PER_MIN);

        // if libido hit zero due to decay, stop the timer and notify the channel
        if (current.libido === 0) {
            stopLibidoDecay(channelId);
            try {
                const channel = await client.channels.fetch(channelId);
                if (channel && channel.send) {
                    await channel.send(`😒 **${current.name}** has lost interest and feels a bit down.`);
                }
            } catch (err) {
                console.error("Failed to send libido-uninterested message:", err);
            }
        }
    }, LIBIDO_DECAY_INTERVAL_MS);
}

// stop libido decay timer for a monster (if running)
function stopLibidoDecay(channelId) {
    const m = getMonster(channelId);
    if (!m || !m._decayTimer) return;
    clearInterval(m._decayTimer);
    delete m._decayTimer;
}

// PLAYER DATA (XP SYSTEM)
const players = {};

// ensure player exists
function addPlayer(userId, name) {
    if (!players[userId]) {
        players[userId] = { name, xp: 0, attacks: 0, seductions: 0 };
    }
}

// BAR
function bar(curr, max, type) {
    const size = 10;
    const ratio = curr / max;
    const filled = Math.round(ratio * size);

    let color = "";
    if (type === "libido") {
        for (let i = 0; i < filled; i++) {
            if (ratio <= 0.3) color = "🟪";
            else if (ratio <= 0.6) color = "🟦";
            else color += "🟥";
        }
        return color + "⬛".repeat(size - filled);
    } else {
        let color = "🟩";
        if (ratio <= 0.6) color = "🟨";
        if (ratio <= 0.3) color = "🟥";
        return color.repeat(filled) + "⬛".repeat(size - filled);
    }
}

// COMMANDS
const commands = [
    new SlashCommandBuilder()
        .setName("spawn")
        .setDescription("Spawn a monster")
        .addStringOption(o =>
            o.setName("name").setRequired(true).setDescription("Monster name")
        )
        .addIntegerOption(o =>
            o.setName("hp").setRequired(true).setDescription("Monster HP")
        )
        .addIntegerOption(o =>
            o.setName("maxlibido").setRequired(false).setDescription("Maximum libido (optional)")
        ),

    new SlashCommandBuilder()
        .setName("attack")
        .setDescription("Attack the monster")
        .addIntegerOption(o =>
            o.setName("damage").setRequired(true).setDescription("Damage")
        ),

    new SlashCommandBuilder()
        .setName("seduce")
        .setDescription("Seduce the monster")
        .addIntegerOption(o =>
            o.setName("seduction").setRequired(true).setDescription("Seduction power")
        ),

    new SlashCommandBuilder()
        .setName("rank")
        .setDescription("View top adventurers")
].map(c => c.toJSON());

// REGISTER COMMANDS
client.once("ready", async () => {
    console.log(`Logged in as ${client.user.tag}`);

    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: commands }
    );
});

// SORT LEADERBOARD
async function getLeaderboard() {
    const top = Object.entries(players)
        .sort((a, b) => b[1].xp - a[1].xp)
        .slice(0, 10);

    const rows = await Promise.all(top.map(async ([userId, data], i) => {
        // prefer stored display name, then cached username, then fetch the user
        let display = data.name ?? client.users.cache.get(userId)?.username;
        if (!display) {
            try {
                const user = await client.users.fetch(userId);
                display = user?.username ?? "Unknown";
            } catch {
                display = "Unknown";
            }
        }

        return `${i + 1}. ${display} — ${data.xp} XP (${data.attacks} attacks, ${data.seductions} seductions)`;
    }));

    return rows.join("\n");
}

// DEFEAT CHECK (centralized) - channel-aware
async function checkAndHandleDefeat(interaction, channelId, messageTemplate) {
    const m = getMonster(channelId);
    if (!m) return false;
    const defeatedByLibido = typeof m.maxLibido !== "undefined" && m.libido >= m.maxLibido;
    if (m.hp === 0 || defeatedByLibido) {
        const name = m.name;
        clearMonster(channelId);
        const msg = messageTemplate.replace('{name}', name);
        await interaction.reply(msg);
        return true;
    }
    return false;
}

// ACTION REPLY BUILDER - channel-aware
function buildActionReply(interaction, channelId, amount) {
    // prefer the guild display name (nickname) when available; fallback to username
    const user = interaction.member?.displayName ?? interaction.user.username;
    const commandName = interaction.commandName;
    const m = getMonster(channelId);
    if (!m) return "";

    if (commandName === "attack") {
        let reply = `⚔️ ${user} dealt **${amount}** damage!\n🐉 ${m.name}\n${bar(m.hp, m.maxHp)} HP: ${m.hp}/${m.maxHp}`;
        if (typeof m.maxLibido !== "undefined") {
            reply += `\n${bar(m.libido, m.maxLibido)} 💗 Libido: ${m.libido}/${m.maxLibido}`;
        }
        return reply;
    }

    if (commandName === "seduce") {
        return `💋 ${user} seduced for **${amount}** points!\n🐉 ${m.name}\n${bar(m.hp, m.maxHp)} HP: ${m.hp}/${m.maxHp}\n${bar(m.libido, m.maxLibido)} 💗 Libido: ${m.libido}/${m.maxLibido}`;
    }

    return "";
}

// INTERACTIONS
client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const channelId = interaction.channelId;
    const userId = interaction.user.id;
    // store the guild display name for leaderboard and tracking (fallback to username)
    addPlayer(userId, interaction.member?.displayName ?? interaction.user.username);

    // SPAWN
    if (interaction.commandName === "spawn") {
        const name = interaction.options.getString("name");
        const hp = interaction.options.getInteger("hp");
        const maxLibidoOpt = interaction.options.getInteger("maxlibido");

        // prevent multiple spawns in the same channel
        if (getMonster(channelId)) {
            return interaction.reply("❌ A monster is already spawned in this channel! Deal with it first!");
        }

        if (typeof maxLibidoOpt === "number") {
            setMonster(channelId, { name, hp, maxHp: hp, libido: 0, maxLibido: maxLibidoOpt });
            // start decay timer for this monster
            startLibidoDecay(channelId);
            const m = getMonster(channelId);
            return interaction.reply(
                `🐉 **${name} spawned!**\n${bar(hp, hp)} HP: ${hp}/${hp}\n${bar(0, m.maxLibido)} 💗 Libido: 0/${m.maxLibido}`
            );
        } else {
            setMonster(channelId, { name, hp, maxHp: hp });
            return interaction.reply(
                `🐉 **${name} spawned!**\n${bar(hp, hp)} HP: ${hp}/${hp}`
            );
        }
    }

    // ATTACK
    if (interaction.commandName === "attack") {
        const dmg = Math.max(0, interaction.options.getInteger("damage") ?? 0);

        const m = getMonster(channelId);
        if (!m) {
            return interaction.reply("❌ No monster spawned in this channel!");
        }

        // update player stats
        players[userId].xp += dmg;
        players[userId].attacks += 1;

        m.hp -= dmg;
        if (m.hp < 0) m.hp = 0;

        // centralized defeat check (will clear the monster for this channel)
        if (await checkAndHandleDefeat(interaction, channelId, '💀 You have defeated **{name}**.\n✨ Continue slaying with your words, adventurer!')) {
            return;
        }

        // use reply builder
        const reply = buildActionReply(interaction, channelId, dmg);
        return interaction.reply(reply);
    }

    // SEDUCE
    if (interaction.commandName === "seduce") {
        const seduction = Math.max(0, interaction.options.getInteger("seduction") ?? 0);

        const m = getMonster(channelId);
        if (!m) {
            return interaction.reply("❌ No monster spawned in this channel!");
        }

        // if monster has no libido system, inform the user
        if (typeof m.maxLibido === "undefined") {
            return interaction.reply("❌ This monster cannot be seduced!");
        }

        // update player stats (seduction behaves like an alternative attack but affects libido)
        players[userId].xp += seduction;
        players[userId].seductions += 1;

        m.libido = Math.min(m.maxLibido, m.libido + seduction);

        // start decay only when the seduction amount was > 0 and monster now has libido > 0
        if (seduction > 0 && m.libido > 0) {
            startLibidoDecay(channelId);
        }

        // centralized defeat check
        if (await checkAndHandleDefeat(interaction, channelId, '💦 **{name}** couldn\'t take it anymore. 😩 \n✨ You gave it what it came for — hope you got something out of it too!')) {
            return;
        }

        // use reply builder
        const reply = buildActionReply(interaction, channelId, seduction);
        return interaction.reply(reply);
    }

    // LEADERBOARD
    if (interaction.commandName === "rank") {
        const board = await getLeaderboard();
        return interaction.reply(`🏆 **Top Adventurers**\n\n${board || "No data yet."}`);
    }
});

// LOGIN
client.login(TOKEN);