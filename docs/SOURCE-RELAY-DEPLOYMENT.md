# Relais EPUB pour GitHub Pages

GitHub Pages héberge l’application statique. Le petit service décrit ici récupère les EPUB publics des sources qui n’autorisent pas un import JavaScript direct depuis Pages. Il n’héberge aucun compte utilisateur, bibliothèque personnelle, fichier importé, annotation ni progression. Les recherches ELG sont transmises à sa source pour obtenir des résultats actuels ; les recherches Gutenberg restent faites sur le catalogue local.

## Service déployé

`server/worker.js` et `wrangler.jsonc` définissent un Worker **`fastreader-sources`**, avec un Durable Object unique **`FastReaderSources`** adossé à SQLite. Le plan Workers Free prend en charge les Durable Objects SQLite, dans les quotas indiqués par la [documentation Cloudflare](https://developers.cloudflare.com/durable-objects/platform/pricing/). Un compte Cloudflare authentifié reste nécessaire pour publier. Le drapeau [`nodejs_compat`](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) permet de réutiliser la validation Gutenberg existante, sans recopier sa logique de téléchargement.

Commandes de validation exécutées avec Wrangler **4.131.1** :

```sh
npx --yes --package wrangler@4.131.1 wrangler deploy --dry-run --outdir /tmp/fastreader-worker-dist
npx --yes --package wrangler@4.131.1 wrangler dev --local --port 18787 --inspector-port 19239 --persist-to /tmp/fastreader-worker-state
```

Le dry-run produit environ 192 Kio de code, 44 Kio compressés. Les vrais endpoints locaux ont fourni Alice (Gutenberg 11, 136 519 octets) et Candide (ELG 637, 1 530 924 octets), avec le bon mimetype et CORS. Le contrôle de disponibilité a renvoyé les deux sources accessibles ; une origine étrangère a reçu 403 sans autorisation CORS. Le contrôle public a ensuite réussi sur `https://fastreader-sources.carbonnier-anthony.workers.dev` : statut et recherche ELG 200, EPUB Gutenberg Alice 136 519 octets, EPUB ELG Candide 1 530 924 octets, avec CORS exact. Version Cloudflare initiale : `6e5eaf0c-75b2-43ea-99df-1c7f37c6c0b1`.

Publication depuis un compte déjà authentifié :

```sh
npx --yes --package wrangler@4.131.1 wrangler deploy
```

Après vérification publique, définir `VITE_SOURCE_RELAY_URL=https://fastreader-sources.<sous-domaine>.workers.dev` au build Pages. La valeur est un réglage de déploiement ; aucune notice ne peut la modifier. L’ancien `VITE_GUTENBERG_RELAY_URL` reste accepté comme repli de configuration. `SOURCE_ALLOWED_ORIGIN` vaut `https://drslid.github.io` ; le chemin du projet Pages ne fait pas partie d’une origine CORS.

## Endpoints publics

| Méthode et chemin | Fonction |
| --- | --- |
| `GET /api/books/gutenberg/11.epub` | EPUB original depuis les miroirs Gutenberg autorisés |
| `GET /api/sources/ebooks-gratuits/search?query=Candide&page=1` | Recherche OPDS par titre, format EPUB filtré dans le plugin |
| `GET /api/books/ebooks-gratuits/637.epub` | Acquisition EPUB ELG originale |
| `GET /api/sources/status` | Contrôle d’accessibilité des sources, cache de cinq minutes |

Le contrôle de disponibilité ne télécharge aucun livre : il demande les en-têtes d’un EPUB Gutenberg connu et ceux du point d’entrée OPDS ELG. Une pastille verte indique que l’endpoint répond, pas que chaque édition du catalogue est accessible dans toutes les régions. La réponse est `{checkedAt, sources: [{providerId, available, checkedAt, code}]}`. Les pages HTML de blocage, délais et refus n’obtiennent pas une disponibilité positive.

Les restrictions et limites de chaque relais restent appliquées : seuls les identifiants de livres contrôlés sont acceptés, les redirections sont limitées, la taille est bornée à 30 Mio et aucun en-tête d’authentification de l’utilisateur n’est transmis. Dans le Worker, un seul EPUB est chargé à la fois pour maîtriser la mémoire. Un second téléchargement simultané reçoit 429 avec `Retry-After: 15` ; les recherches et contrôles restent disponibles.

Les plafonds ELG sont globaux : le même Durable Object est utilisé dans toutes les régions. Il conserve uniquement la liste bornée des horodatages des 50 dernières tentatives sur 24 heures, avant le contact amont. Les archives et réponses de recherche sont seulement en cache mémoire borné. Ne pas changer le nom constant de cet objet ni supprimer son stockage pour réinitialiser un quota.

## Pipeline

Le job `deploy-sources` du dépôt déploie ce Worker automatiquement quand **`vars.SOURCE_RELAY_DEPLOY_ENABLED == 'true'`**. Fournir au job `CLOUDFLARE_API_TOKEN` via les secrets GitHub et `CLOUDFLARE_ACCOUNT_ID` via les variables GitHub, puis exécuter Wrangler 4.131.1. Le job doit attendre les vérifications unitaires et navigateur, puis contrôler l’URL publique avant le build Pages qui utilise `VITE_SOURCE_RELAY_URL`. Le service actuel a été publié avec la connexion OAuth locale disponible. Le job automatique reste désactivé tant qu’un jeton CI n’est pas configuré ; cela n’empêche pas le déploiement automatique de l’interface Pages vers le service existant. Une connexion OAuth locale ne doit jamais être copiée dans le dépôt ou les logs du pipeline.

Pour un serveur Node existant, `npm start` expose les mêmes routes. Définir `SOURCE_ALLOWED_ORIGIN` lorsque le client est sur une autre origine, et utiliser HTTPS en production. En cas de plusieurs instances Node, le callback de réservation ELG doit partager et persister ses quotas ; le déploiement Durable Object fourni satisfait déjà ce point.
