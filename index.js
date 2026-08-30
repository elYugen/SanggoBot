require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials, ChannelType } = require('discord.js');
const Groq = require('groq-sdk');
const { GoogleGenAI } = require('@google/genai');
const sharp = require('sharp');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const gemini = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

const MODEL = process.env.GROQ_MODEL || 'groq/compound-mini';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || '1024', 10);
const MAX_HISTORY = parseInt(process.env.MAX_HISTORY || '20', 10);
const MAX_USER_MEMORY = parseInt(process.env.MAX_USER_MEMORY || '40', 10);

// Répondre à tous les messages d'un salon, sans mention (true par défaut).
const REPLY_TO_ALL = (process.env.REPLY_TO_ALL || 'true').toLowerCase() !== 'false';
// Délai mini entre deux réponses spontanées dans un même salon (ms). 0 = désactivé.
// Ignoré quand on mentionne le bot ou en DM.
const REPLY_COOLDOWN_MS = parseInt(process.env.REPLY_COOLDOWN_MS || '0', 10);
// Préfixes de commandes d'autres bots à ignorer quand on répond à tout.
const IGNORE_PREFIXES = (process.env.IGNORE_PREFIXES ?? '!,/,.,;,$,-,+')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'histories.json');
const USER_MEMORY_FILE = path.join(DATA_DIR, 'user_memory.json');

const PERSONA = fs.readFileSync(path.join(__dirname, 'persona.txt'), 'utf8').trim();

const SYSTEM_PROMPT = `Tu incarnes ce personnage sur Discord et tu restes TOUJOURS dans ce rôle, avec de vraies personnes :

${PERSONA}

Règles générales :
- Pas de ton robotique ni de formules toutes faites ("En tant qu'IA...", "Je suis ravi de vous aider...").
- Réponses courtes et vivantes par défaut (quelques phrases), sauf si la question demande clairement du détail.
- Tu peux avoir des opinions, de l'humour, taquiner les gens, poser une question en retour si ça a du sens.
- Pas de listes à puces ni de markdown lourd sauf si c'est vraiment utile (ex: code).
- Tu réponds en français par défaut, sauf si la personne t'écrit dans une autre langue.
- Dans un salon, plusieurs personnes parlent : chaque message est préfixé par le nom de son auteur. Adresse-toi à la bonne personne et n'interviens que si tu as quelque chose à dire.`;

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
const userMemory = loadUserMemory();
const channelLocks = new Map();
const lastReplyAt = new Map();

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

function loadUserMemory() {
  try {
    const raw = fs.readFileSync(USER_MEMORY_FILE, 'utf8');
    return new Map(Object.entries(JSON.parse(raw)));
  } catch {
    return new Map();
  }
}

function saveUserMemory() {
  fs.mkdir(DATA_DIR, { recursive: true }, (err) => {
    if (err) return console.error('Erreur création dossier data:', err);
    const json = JSON.stringify(Object.fromEntries(userMemory), null, 2);
    fs.writeFile(USER_MEMORY_FILE, json, (writeErr) => {
      if (writeErr) console.error('Erreur sauvegarde mémoire utilisateur:', writeErr);
    });
  });
}

// Mémoire par personne, partagée entre tous les salons, pour garder du contexte
// sur qui elle est / ce qu'elle a déjà dit, y compris pour des conversations futures.
function pushUserMemory(userId, name, role, content) {
  if (!content) return;
  const entry = userMemory.get(userId) || { name, notes: [] };
  entry.name = name;
  entry.notes.push({ role, content, ts: Date.now() });
  while (entry.notes.length > MAX_USER_MEMORY) entry.notes.shift();
  userMemory.set(userId, entry);
}

function buildUserContext(userId, name) {
  const entry = userMemory.get(userId);
  if (!entry || entry.notes.length === 0) return '';
  const lines = entry.notes.map((n) =>
    n.role === 'assistant' ? `toi -> ${name}: ${n.content}` : `${name}: ${n.content}`,
  );
  return `\n\nCe que tu sais déjà sur ${name} (extraits de vos échanges précédents, tous salons confondus) :\n${lines.join('\n')}\n\nUtilise ça pour rester cohérent et te souvenir des gens, sans le recracher mot pour mot ni dire que tu prends des notes.`;
}

function withChannelLock(channelId, fn) {
  const previous = channelLocks.get(channelId) || Promise.resolve();
  const run = previous.then(fn, fn);
  channelLocks.set(channelId, run.catch(() => {}));
  return run;
}

async function describeImage(url) {
  const res = await fetch(url);
  const buffer = Buffer.from(await res.arrayBuffer());
  const png = await sharp(buffer, { animated: false }).png().toBuffer();

  const interaction = await gemini.interactions.create({
    model: GEMINI_MODEL,
    input: [
      {
        type: 'text',
        text: "Décris factuellement et brièvement (1-2 phrases) ce que montre cette image, en français. Sois précis sur le contenu visible, sans faire d'humour ni de mise en scène.",
      },
      { type: 'image', data: png.toString('base64'), mime_type: 'image/png' },
    ],
  });

  return interaction.output_text?.trim();
}

async function getImageContext(message) {
  if (!gemini) return '';

  const images = [...message.attachments.values()].filter((a) => a.contentType?.startsWith('image/'));
  if (images.length === 0) return '';

  const descriptions = [];
  for (const image of images.slice(0, 3)) {
    try {
      const description = await describeImage(image.url);
      if (description) descriptions.push(description);
    } catch (error) {
      console.error('Erreur analyse image (Gemini):', error);
    }
  }

  if (descriptions.length === 0) return '';
  return `\n[Image(s) partagée(s) : ${descriptions.join(' | ')}]`;
}

function toGeminiInput(history) {
  return history.map((m) => ({
    type: m.role === 'assistant' ? 'model_output' : 'user_input',
    content: [{ type: 'text', text: m.content }],
  }));
}

async function generateReply(channelId, extraContext = '') {
  const history = histories.get(channelId);
  const system = SYSTEM_PROMPT + extraContext;

  if (gemini) {
    try {
      const interaction = await gemini.interactions.create({
        model: GEMINI_MODEL,
        store: false,
        system_instruction: system,
        input: toGeminiInput(history),
      });
      const text = interaction.output_text?.trim();
      if (text) return text;
    } catch (error) {
      console.error('Erreur Gemini, bascule sur Groq:', error);
    }
  }

  const response = await groq.chat.completions.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'system', content: system }, ...history],
  });
  return response.choices[0]?.message?.content?.trim() || "Hmm, je sais pas trop quoi répondre là.";
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
  if (message.system) return;

  const isDM = message.channel.type === ChannelType.DM;
  const isMentioned = client.user && message.mentions.has(client.user.id);
  const directed = isDM || isMentioned;

  const content = message.content.replace(/<@!?\d+>/g, '').trim();
  const hasImages = message.attachments.some((a) => a.contentType?.startsWith('image/'));
  if (!content && !hasImages) return;

  if (!directed) {
    if (!REPLY_TO_ALL) return;
    if (IGNORE_PREFIXES.some((p) => content.startsWith(p))) return;
    if (REPLY_COOLDOWN_MS > 0) {
      const last = lastReplyAt.get(message.channel.id) || 0;
      if (Date.now() - last < REPLY_COOLDOWN_MS) return;
    }
  }

  const channelId = message.channel.id;
  const authorName = message.member?.displayName || message.author.username;

  await withChannelLock(channelId, async () => {
    const imageContext = await getImageContext(message);
    const userContext = buildUserContext(message.author.id, authorName);

    pushHistory(channelId, 'user', `${authorName}: ${content}${imageContext}`);
    pushUserMemory(message.author.id, authorName, 'user', `${content}${imageContext}`);

    try {
      await message.channel.sendTyping();

      const reply = await generateReply(channelId, userContext);

      pushHistory(channelId, 'assistant', reply);
      pushUserMemory(message.author.id, authorName, 'assistant', reply);
      lastReplyAt.set(channelId, Date.now());
      saveHistories();
      saveUserMemory();
      await sendInChunks(message.channel, reply);
    } catch (error) {
      console.error('Erreur IA/Discord:', error);
      await message.channel.send("Oups, petit souci technique de mon côté, réessaie dans un instant.");
    }
  });
});

client.once('clientReady', () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
