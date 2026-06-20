const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require("discord.js");

const TOKEN = process.env.TOKEN;

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
    delete monsters[channelId];
}

// PLAYER DATA (XP SYSTEM)
const players = {};

// ensure player exists
function addPlayer(userId, name) {
    if (!players[userId]) {
        players[userId] = { name, xp: 0, attacks: 0, seductions: 0 };
    }
}

// HP BAR
function bar(hp, maxHp) {
    const size = 10;
    const ratio = hp / maxHp;

    let color = "🟩";
    if (ratio <= 0.6) color = "🟨";
    if (ratio <= 0.3) color = "🟥";

    const filled = Math.round(ratio * size);
    return color.repeat(filled) + "⬛".repeat(size - filled);
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
function getLeaderboard() {
    return Object.entries(players)
        .sort((a, b) => b[1].xp - a[1].xp)
        .slice(0, 10)
        .map((p, i) =>
            `${i + 1}. ${p[1].name} — ${p[1].xp} XP (${p[1].attacks} attacks, ${p[1].seductions} seductions)`
        )
        .join("\n");
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
    const user = interaction.user.username;
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
    addPlayer(userId, interaction.user.username);

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
        return interaction.reply(
            `🏆 **Top Adventurers**\n\n${getLeaderboard() || "No data yet."}`
        );
    }
});

// LOGIN
client.login(TOKEN);