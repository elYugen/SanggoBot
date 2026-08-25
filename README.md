# Bot Discord + Groq (IA conversationnelle, gratuite)

Bot Discord qui répond avec un modèle IA via Groq de façon naturelle et "humaine" : en DM, ou dans un salon quand on le mentionne (@bot). Il garde le contexte de la conversation par salon.

## 1. Créer l'application Discord

1. Va sur https://discord.com/developers/applications > **New Application**.
2. Onglet **Bot** > **Reset Token** > copie le token (tu le mettras dans `.env`).
3. Toujours dans **Bot**, active **Message Content Intent** (sous "Privileged Gateway Intents") — indispensable pour lire le texte des messages.
4. Onglet **OAuth2 > URL Generator** :
   - Scopes : `bot`
   - Permissions : `Send Messages`, `Read Message History`, `View Channels`
   - Ouvre l'URL générée pour inviter le bot sur ton serveur.

## 2. Récupérer une clé API Groq (gratuite)

Sur https://console.groq.com > API Keys > créer une clé. Aucune carte bancaire requise, quota gratuit généreux.

## 3. Configuration

```bash
npm install
cp .env.example .env
```

Remplis `.env` avec `DISCORD_TOKEN` et `GROQ_API_KEY`.

## 4. Lancer le bot

```bash
npm start
```

## Fonctionnement

- Le bot répond aux messages privés (DM) et aux messages où il est mentionné dans un salon.
- Il garde jusqu'à `MAX_HISTORY` messages de contexte par salon (réglable dans `.env`).
- Modèle par défaut : `groq/compound-mini` (gratuit sur Groq, rapide, peu enclin à refuser des sujets anodins). `groq/compound` (version plus costaude) donne des réponses plus riches si besoin. À éviter pour ce bot : les modèles `openai/gpt-oss-*`, qui refusent silencieusement (réponse vide) sur des sujets pourtant inoffensifs (ex: conseils amoureux pour rigoler), et `qwen/qwen3.6-27b`, qui fait fuiter son raisonnement interne dans la réponse.
- Le catalogue de modèles Groq change assez souvent — pour voir ceux réellement disponibles sur ta clé, interroge `GET https://api.groq.com/openai/v1/models` avec ton `GROQ_API_KEY`, ou regarde https://console.groq.com/docs/models.

## Personnalité du bot

L'identité et le style d'écriture du bot sont définis dans [persona.txt](persona.txt) (nom, rôle, ton...). Modifie ce fichier pour changer le personnage — pas besoin de toucher au code. Les règles générales de conversation (pas de ton robotique, réponses courtes, etc.) sont dans `SYSTEM_PROMPT` dans [index.js](index.js).

## Sauvegarde des conversations

L'historique de chaque salon est sauvegardé automatiquement dans `data/histories.json` après chaque échange, et rechargé au démarrage du bot — donc plus rien n'est perdu au redémarrage. Ce dossier `data/` est volontairement exclu de git (`.gitignore`) car il contient le contenu des conversations. Pour repartir de zéro, supprime simplement `data/histories.json`.

## Pour aller plus loin

- Répondre dans tous les messages d'un salon (pas juste sur mention) : modifie la condition dans `messageCreate`.
- Héberger le bot en continu : Railway, Fly.io, un VPS, ou un service systemd.
