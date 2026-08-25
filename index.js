require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials, ChannelType } = require('discord.js');
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MODEL = process.env.GROQ_MODEL || 'groq/compound-mini';
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || '1024', 10);
const MAX_HISTORY = parseInt(process.env.MAX_HISTORY || '20', 10);

const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'histories.json');

const PERSONA = fs.readFileSync(path.join(__dirname, 'persona.txt'), 'utf8').trim();

const SYSTEM_PROMPT = `Tu incarnes ce personnage sur Discord et tu restes TOUJOURS dans ce rôle, avec de vraies personnes :

${PERSONA}

Règles générales :
- Pas de ton robotique ni de formules toutes faites ("En tant qu'IA...", "Je suis ravi de vous aider...").
- Réponses courtes et vivantes par défaut (quelques phrases), sauf si la question demande clairement du détail.
- Tu peux avoir des opinions, de l'humour, taquiner les gens, poser une question en retour si ça a du sens.
- Pas de listes à puces ni de markdown lourd sauf si c'est vraiment utile (ex: code).
- Tu réponds en français par défaut, sauf si la personne t'écrit dans une autre langue.`;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

const histories = loadHistories();
const channelLocks = new Map();

function loadHistories() {
  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
    return new Map(Object.entries(JSON.parse(raw)));
  } catch {
    return new Map();
  }
}

function saveHistories() {
  fs.mkdir(DATA_DIR, { recursive: true }, (err) => {
    if (err) return console.error('Erreur création dossier data:', err);
    const json = JSON.stringify(Object.fromEntries(histories), null, 2);
    fs.writeFile(HISTORY_FILE, json, (writeErr) => {
      if (writeErr) console.error('Erreur sauvegarde historique:', writeErr);
    });
  });
}

function pushHistory(channelId, role, content) {
  const history = histories.get(channelId) || [];
  history.push({ role, content });
  while (history.length > MAX_HISTORY) history.shift();
  histories.set(channelId, history);
}

function withChannelLock(channelId, fn) {
  const previous = channelLocks.get(channelId) || Promise.resolve();
  const run = previous.then(fn, fn);
  channelLocks.set(channelId, run.catch(() => {}));
  return run;
}

async function sendInChunks(channel, text) {
  const limit = 1900;
  let remaining = text;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf('\n', limit);
    if (cut <= 0) cut = limit;
    await channel.send(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) await channel.send(remaining);
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const isDM = message.channel.type === ChannelType.DM;
  const isMentioned = client.user && message.mentions.has(client.user.id);
  if (!isDM && !isMentioned) return;

  const content = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!content) return;

  const channelId = message.channel.id;
  const authorName = message.member?.displayName || message.author.username;

  await withChannelLock(channelId, async () => {
    pushHistory(channelId, 'user', `${authorName}: ${content}`);

    try {
      await message.channel.sendTyping();

      const response = await groq.chat.completions.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...histories.get(channelId)],
      });

      const reply = response.choices[0]?.message?.content?.trim() || "Hmm, je sais pas trop quoi répondre là.";

      pushHistory(channelId, 'assistant', reply);
      saveHistories();
      await sendInChunks(message.channel, reply);
    } catch (error) {
      console.error('Erreur Groq/Discord:', error);
      await message.channel.send("Oups, petit souci technique de mon côté, réessaie dans un instant.");
    }
  });
});

client.once('clientReady', () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
