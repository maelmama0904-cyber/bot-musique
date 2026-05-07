require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
} = require("@discordjs/voice");

const youtubedl = require("youtube-dl-exec");
const ytSearch = require("yt-search");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const queues = new Map();

const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Joue une musique")
    .addStringOption(option =>
      option
        .setName("recherche")
        .setDescription("Nom ou lien YouTube")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Passe la musique"),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Arrête la musique"),
].map(cmd => cmd.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(
      process.env.CLIENT_ID,
      process.env.GUILD_ID
    ),
    { body: commands }
  );

  console.log("Commandes enregistrées.");
}

async function searchYoutube(query) {
  if (query.includes("youtube.com") || query.includes("youtu.be")) {
    return {
      title: "Lien YouTube",
      url: query,
    };
  }

  const result = await ytSearch(query);

  if (!result.videos.length) return null;

  return {
    title: result.videos[0].title,
    url: result.videos[0].url,
  };
}

async function playMusic(guildId) {
  console.log("playMusic appelée");

  const queue = queues.get(guildId);

  if (!queue || queue.songs.length === 0) {
    console.log("Queue vide");

    queue?.connection?.destroy();

    queues.delete(guildId);

    return;
  }

  const song = queue.songs[0];

  console.log("Musique trouvée :", song.title);
  console.log("URL :", song.url);

  try {

    const subprocess = youtubedl.exec(
      song.url,
      {
        output: "-",
        format: "bestaudio",
        quiet: true,
        noWarnings: true,
      },
      {
        stdio: ["ignore", "pipe", "ignore"],
      }
    );

    const resource = createAudioResource(
      subprocess.stdout,
      {
        inlineVolume: true,
      }
    );

    resource.volume.setVolume(1);

    queue.player.play(resource);

    console.log("Audio lancé avec yt-dlp !");

  } catch (err) {

    console.error(
      "Erreur dans playMusic :",
      err
    );

    queue.songs.shift();

    playMusic(guildId);
  }
}
client.once("ready", () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const guildId = interaction.guild.id;
  let queue = queues.get(guildId);

  if (interaction.commandName === "play") {
    await interaction.deferReply();

    const voiceChannel = interaction.member.voice.channel;

    if (!voiceChannel) {
      return interaction.editReply("Rejoins un salon vocal.");
    }

    const query = interaction.options.getString("recherche");
    const song = await searchYoutube(query);

    if (!song) {
      return interaction.editReply("Aucun résultat trouvé.");
    }

    if (!queue) {
      const player = createAudioPlayer();

      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });

      connection.subscribe(player);

      queue = {
        connection,
        player,
        songs: [song],
      };

      queues.set(guildId, queue);

      player.on(AudioPlayerStatus.Idle, () => {
        const currentQueue = queues.get(guildId);

        if (!currentQueue) return;

        currentQueue.songs.shift();

        playMusic(guildId);
      });

      player.on("error", error => {
        console.error("Erreur player :", error);
      });

      await interaction.editReply(`Lecture : ${song.title}`);

      playMusic(guildId);
    } else {
      queue.songs.push(song);

      await interaction.editReply(`Ajouté : ${song.title}`);
    }
  }

  if (interaction.commandName === "skip") {
    if (!queue) return interaction.reply("Aucune musique.");

    queue.player.stop();

    return interaction.reply("Musique passée.");
  }

  if (interaction.commandName === "stop") {
    if (!queue) return interaction.reply("Aucune musique.");

    queue.songs = [];

    queue.player.stop();

    queue.connection.destroy();

    queues.delete(guildId);

    return interaction.reply("Musique arrêtée.");
  }
});

registerCommands()
  .then(() => client.login(process.env.TOKEN))
  .catch(console.error);