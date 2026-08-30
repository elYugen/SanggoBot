# Bot Discord + Gemini (IA conversationnelle, gratuite)

Bot Discord qui répond avec Google Gemini de façon naturelle et "humaine" : en DM, et dans les salons où il est présent. Par défaut il répond à **tous** les messages (pas besoin de le mentionner). Il garde le contexte de la conversation par salon, se souvient des gens d'une conversation à l'autre, et peut aussi réagir aux images/gifs envoyés.

## 1. Créer l'application Discord

1. Va sur https://discord.com/developers/applications > **New Application**.
2. Onglet **Bot** > **Reset Token** > copie le token (tu le mettras dans `.env`).
3. Toujours dans **Bot**, active **Message Content Intent** (sous "Privileged Gateway Intents") — indispensable pour lire le texte des messages.
4. Onglet **OAuth2 > URL Generator** :
   - Scopes : `bot`
   - Permissions : `Send Messages`, `Read Message History`, `View Channels`
   - Ouvre l'URL générée pour inviter le bot sur ton serveur.

## 2. Récupérer une clé API Google Gemini (gratuite)

Sur https://aistudio.google.com/apikey > créer une clé. C'est le moteur principal de conversation et d'analyse d'images/gifs.

## 3. (Optionnel) Récupérer une clé API Groq (gratuite)

Sur https://console.groq.com > API Keys > créer une clé. Sert uniquement de secours automatique si Gemini est indisponible ou échoue — pas obligatoire, mais recommandé pour la fiabilité.

## 4. Configuration

```bash
npm install
cp .env.example .env
```

Remplis `.env` avec au minimum `DISCORD_TOKEN` et `GEMINI_API_KEY`, et `GROQ_API_KEY` si tu veux le filet de secours.

## 5. Lancer le bot

```bash
npm start
```

## Fonctionnement

- Le bot répond aux messages privés (DM) et, dans les salons, à **tous les messages** par défaut (`REPLY_TO_ALL=true`). Pour revenir au comportement "uniquement sur mention", mets `REPLY_TO_ALL=false` dans `.env`.
- Quand il répond à tout, il ignore les messages commençant par un préfixe de commande (`IGNORE_PREFIXES`, ex: `!`, `/`, `.`) pour ne pas réagir aux commandes d'autres bots.
- `REPLY_COOLDOWN_MS` impose un délai mini entre deux réponses spontanées dans un même salon (0 = désactivé). Une mention ou un DM passe toujours, sans délai.
- Il garde jusqu'à `MAX_HISTORY` messages de contexte par salon (réglable dans `.env`).
- **Moteur principal : Gemini** (`GEMINI_MODEL`, par défaut `gemini-3.5-flash`). Si Gemini échoue (erreur, quota dépassé, pas de clé), le bot bascule automatiquement sur **Groq** (`GROQ_MODEL`, par défaut `groq/compound-mini`) s'il est configuré.
- À éviter pour ce bot si tu changes de modèle Groq : `openai/gpt-oss-*`, qui refusent silencieusement (réponse vide) des sujets pourtant inoffensifs, et `qwen/qwen3.6-27b`, qui fait fuiter son raisonnement interne dans la réponse.

## Personnalité du bot

L'identité et le style d'écriture du bot sont définis dans [persona.txt](persona.txt) (nom, rôle, ton...). Modifie ce fichier pour changer le personnage — pas besoin de toucher au code. Les règles générales de conversation (pas de ton robotique, réponses courtes, etc.) sont dans `SYSTEM_PROMPT` dans [index.js](index.js).

## Analyse d'images et de gifs

Le bot "voit" les images/gifs envoyés dans les messages où il est mentionné (ou en DM) : Gemini décrit factuellement le contenu, puis Sanggo réagit dessus dans son style habituel. Les gifs sont convertis en image fixe (1ère frame) avant analyse, Gemini ne traitant pas le format GIF nativement. Limité à 3 images par message pour éviter les abus/latence. Nécessite `GEMINI_API_KEY` (sinon le bot ignore simplement les images).

## Sauvegarde des conversations et mémoire des personnes

- **Historique par salon** : sauvegardé dans `data/histories.json` après chaque échange, rechargé au démarrage. Rien n'est perdu au redémarrage.
- **Mémoire par personne** : `data/user_memory.json` garde jusqu'à `MAX_USER_MEMORY` extraits des échanges de chaque personne (ses messages + les réponses du bot), **partagés entre tous les salons**. À chaque réponse, le bot reçoit ce contexte sur son interlocuteur pour rester cohérent et se souvenir des gens dans de futures conversations, même dans un autre salon ou après un redémarrage.

Le dossier `data/` est exclu de git (`.gitignore`) car il contient le contenu des conversations. Pour repartir de zéro, supprime `data/histories.json` et/ou `data/user_memory.json`.

## Pour aller plus loin

- Limiter le bot à certains salons : filtre sur `message.channel.id` dans `messageCreate`.
- Héberger le bot en continu : Railway, Fly.io, un VPS, ou un service systemd.
