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
    if (monster.hp === 0 || monster.libido >= monster.maxLibido) {
        const name = monster.name;
        monster = null;
        // messageTemplate may use {name} placeholder
        const msg = messageTemplate.replace('{name}', name);
        await interaction.reply(msg);
        return true;
    }
    return false;
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

        // initialize libido alongside HP. maxLibido is set to maxHp for the same scale.
        monster = { name, hp, maxHp: hp, libido: 0, maxLibido: hp };

        return interaction.reply(
            `🐉 **${name} spawned!**\nHP: ${bar(hp, hp)} ${hp}/${hp}\n💗 Libido: ${bar(0, monster.maxLibido)} 0/${monster.maxLibido}`
        );
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

        return interaction.reply(
            `⚔️ ${interaction.user.username} dealt **${dmg}** damage!\n🐉 ${monster.name}\nHP: ${bar(monster.hp, monster.maxHp)} ${monster.hp}/${monster.maxHp}\n💗 Libido: ${bar(monster.libido, monster.maxLibido)} ${monster.libido}/${monster.maxLibido}`
        );
    }

    // SEDUCE
    if (interaction.commandName === "seduce") {
        const seduction = Math.max(0, interaction.options.getInteger("seduction") ?? 0);

        if (!monster) {
            return interaction.reply("❌ No monster spawned!");
        }

        // update player stats (seduction behaves like an alternative attack but affects libido)
        players[userId].xp += seduction;
        players[userId].seductions += 1;

        monster.libido = Math.min(monster.maxLibido, monster.libido + seduction);

        // centralized defeat check
        if (await checkAndHandleDefeat(interaction, '💀 You have defeated **{name}**.\n✨ Your charms proved lethal — well played!')) {
            return;
        }

        return interaction.reply(
            `💋 ${interaction.user.username} seduced for **${seduction}** points!\n🐉 ${monster.name}\nHP: ${bar(monster.hp, monster.maxHp)} ${monster.hp}/${monster.maxHp}\n💗 Libido: ${bar(monster.libido, monster.maxLibido)} ${monster.libido}/${monster.maxLibido}`
        );
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


