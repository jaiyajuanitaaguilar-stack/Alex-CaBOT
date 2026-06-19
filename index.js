const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require("discord.js");

const TOKEN = process.env.TOKEN;

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

let monster = null;

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

// DEFEAT CHECK (centralized)
async function checkAndHandleDefeat(interaction, messageTemplate) {
    if (!monster) return false;
    const defeatedByLibido = typeof monster.maxLibido !== "undefined" && monster.libido >= monster.maxLibido;
    if (monster.hp === 0 || defeatedByLibido) {
        const name = monster.name;
        monster = null;
        // messageTemplate may use {name} placeholder
        const msg = messageTemplate.replace('{name}', name);
        await interaction.reply(msg);
        return true;
    }
    return false;
}

// ACTION REPLY BUILDER
function buildActionReply(interaction, amount) {
    const user = interaction.user.username;
    const commandName = interaction.commandName;
    if (!monster) return "";

    if (commandName === "attack") {
        let reply = `⚔️ ${user} dealt **${amount}** damage!\n
        🐉 ${monster.name}\n
        ${bar(monster.hp, monster.maxHp)} HP: ${monster.hp}/${monster.maxHp}`;
        if (typeof monster.maxLibido !== "undefined") {
            reply += `\n${bar(monster.libido, monster.maxLibido)} 💗 Libido: ${monster.libido}/${monster.maxLibido}`;
        }
        return reply;
    }

    if (commandName === "seduce") {
        // seduce only valid when monster.maxLibido exists; caller already enforces that
        return
        `💋 ${user} seduced for **${amount}** points!\n
        🐉 ${monster.name}\n
        ${bar(monster.hp, monster.maxHp)} HP: ${monster.hp}/${monster.maxHp}\n
        ${bar(monster.libido, monster.maxLibido)} 💗 Libido: ${monster.libido}/${monster.maxLibido}`;
    }

    // fallback
    return "";
}

// INTERACTIONS
client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const userId = interaction.user.id;
    addPlayer(userId, interaction.user.username);

    // SPAWN
    if (interaction.commandName === "spawn") {
        const name = interaction.options.getString("name");
        const hp = interaction.options.getInteger("hp");
        const maxLibidoOpt = interaction.options.getInteger("maxlibido");

        // initialize monster; only include libido fields when the option is provided

        if (monster) {
            return interaction.reply("❌ A monster is already spawned! Deal with it first!");
        }

        if (typeof maxLibidoOpt === "number") {
            monster = { name, hp, maxHp: hp, libido: 0, maxLibido: maxLibidoOpt };
            return interaction.reply(
                `🐉 **${name} spawned!**\n
                ${bar(hp, hp)} HP: ${hp}/${hp}\n
                ${bar(0, monster.maxLibido)} 💗 Libido: 0/${monster.maxLibido}`
            );
        } else {
            monster = { name, hp, maxHp: hp };
            return interaction.reply(
                `🐉 **${name} spawned!**\n${bar(hp, hp)} HP: ${hp}/${hp}`
            );
        }
    }

    // ATTACK
    if (interaction.commandName === "attack") {
        const dmg = Math.max(0, interaction.options.getInteger("damage") ?? 0);

        if (!monster) {
            return interaction.reply("❌ No monster spawned!");
        }

        // update player stats
        players[userId].xp += dmg;
        players[userId].attacks += 1;

        monster.hp -= dmg;
        if (monster.hp < 0) monster.hp = 0;

        // centralized defeat check
        if (await checkAndHandleDefeat(interaction, '💀 You have defeated **{name}**.\n✨ Continue slaying with your words, adventurer!')) {
            return;
        }

        // use reply builder
        const reply = buildActionReply(interaction, dmg);
        return interaction.reply(reply);
    }

    // SEDUCE
    if (interaction.commandName === "seduce") {
        const seduction = Math.max(0, interaction.options.getInteger("seduction") ?? 0);

        if (!monster) {
            return interaction.reply("❌ No monster spawned!");
        }

        // if monster has no libido system, inform the user
        if (typeof monster.maxLibido === "undefined") {
            return interaction.reply("❌ This monster cannot be seduced!");
        }

        // update player stats (seduction behaves like an alternative attack but affects libido)
        players[userId].xp += seduction;
        players[userId].seductions += 1;

        monster.libido = Math.min(monster.maxLibido, monster.libido + seduction); 

        // centralized defeat check
        if (await checkAndHandleDefeat(interaction, '💦 **{name}** couldn\'nt take it anymore. 😩 \n✨ You gave it what it came for — hope you got something out of it too!')) {
            return;
        }

        // use reply builder
        const reply = buildActionReply(interaction, seduction);
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


