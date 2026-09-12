# Relais EPUB pour GitHub Pages

GitHub Pages héberge l’application statique. Le petit service décrit ici récupère les EPUB publics des sources qui n’autorisent pas un import JavaScript direct depuis Pages. Il n’héberge aucun compte utilisateur, bibliothèque personnelle, fichier importé, annotation ni progression. Les recherches ELG, Faded Page et epubBooks sont transmises à leurs sources pour obtenir des résultats actuels ; les recherches Gutenberg restent faites sur le catalogue local et Standard Ebooks est accessible directement depuis le navigateur.

## Service déployé

`server/worker.js` et `wrangler.jsonc` définissent un Worker **`fastreader-sources`**, avec un Durable Object unique **`FastReaderSources`** adossé à SQLite. Le plan Workers Free prend en charge les Durable Objects SQLite, dans les quotas indiqués par la [documentation Cloudflare](https://developers.cloudflare.com/durable-objects/platform/pricing/). Un compte Cloudflare authentifié reste nécessaire pour publier. Le drapeau [`nodejs_compat`](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) permet de réutiliser la validation Gutenberg existante, sans recopier sa logique de téléchargement.

Commandes de validation exécutées avec Wrangler **4.131.1** :

```sh
npx --yes --package wrangler@4.131.1 wrangler deploy --dry-run --outdir /tmp/fastreader-worker-dist
npx --yes --package wrangler@4.131.1 wrangler dev --local --port 18787 --inspector-port 19239 --persist-to /tmp/fastreader-worker-state
```

Le premier déploiement, avant les adaptateurs Faded Page et epubBooks, produisait environ 192 Kio de code, 44 Kio compressés. Ses vrais endpoints locaux ont fourni Alice (Gutenberg 11, 136 519 octets) et Candide (ELG 637, 1 530 924 octets), avec le bon mimetype et CORS. Le contrôle de disponibilité a renvoyé les deux sources accessibles ; une origine étrangère a reçu 403 sans autorisation CORS. Le contrôle public a ensuite réussi sur `https://fastreader-sources.carbonnier-anthony.workers.dev` : statut et recherche ELG 200, EPUB Gutenberg Alice 136 519 octets, EPUB ELG Candide 1 530 924 octets, avec CORS exact. Version Cloudflare initiale : `bd7e8684-a0ae-4b01-ba1d-5101ddd69b0a`.

Les essais du 12 septembre ont ensuite vérifié Faded Page avec Node et le runtime Workers local : recherche `Jane` 200, EPUB `20260903` de 296 961 octets, fichiers identiques dans les deux environnements, session anonyme non exposée, puis import réel sur téléphone simulé. L’adaptateur epubBooks a fourni une recherche réelle, l’EPUB *Frankenstein* de 270 697 octets et sa couverture de catalogue de 73 225 octets. Ces vérifications amont sont distinctes des tests à fixtures et du contrôle public à effectuer après toute publication du Worker. Voir les audits [Faded Page](SOURCE-FADEDPAGE-AUDIT.md) et [epubBooks](SOURCE-EPUBBOOKS-AUDIT.md).

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
| `GET /api/sources/fadedpage/search?query=Jane&page=1` | Recherche publique par titre en anglais ; réponse JSON bornée |
| `GET /api/books/fadedpage/20260903.epub` | Fiche publique, session anonyme locale à l’opération, puis EPUB annoncé |
| `GET /api/sources/epubbooks/search?query=Frankenstein&page=1` | Résultats publics anglais ; page unique et total approximatif |
| `GET /api/books/epubbooks/22-frankenstein.epub` | Acquisition EPUB via le téléchargement anonyme officiel |
| `GET /api/sources/epubbooks/cover/22-frankenstein.jpg` | Image de catalogue validée et bornée, conservée après import pour l’usage hors ligne |
| `GET /api/sources/status` | Contrôle d’accessibilité des sources, cache de cinq minutes |

Le contrôle de disponibilité ne télécharge aucun livre : il demande les en-têtes d’un EPUB Gutenberg connu et ceux du point d’entrée OPDS ELG, puis vérifie les pages de catalogue de Faded Page et epubBooks. Faded Page utilise `HEAD /csearch.php` ; epubBooks utilise `GET /` avec annulation du corps, car ce site refuse HEAD avec le statut 405. Une pastille verte indique que l’endpoint répond, pas que chaque édition du catalogue est accessible dans toutes les régions. La réponse est `{checkedAt, sources: [{providerId, available, checkedAt, code}]}`. Un mauvais type MIME, un délai, une redirection ou un statut de refus n’obtient pas une disponibilité positive.

Les restrictions et limites de chaque relais restent appliquées : seuls les identifiants de livres contrôlés sont acceptés, les redirections sont limitées, la taille est bornée à 30 Mio et aucun en-tête d’authentification de l’utilisateur n’est transmis. Dans le Worker, un seul EPUB est chargé à la fois pour maîtriser la mémoire. Un second téléchargement simultané reçoit 429 avec `Retry-After: 15` ; les recherches et contrôles restent disponibles.

Les plafonds ELG sont globaux : le même Durable Object est utilisé dans toutes les régions. Il conserve uniquement la liste bornée des horodatages des 50 dernières tentatives sur 24 heures, avant le contact amont. Les archives et réponses de recherche sont seulement en cache mémoire borné. Ne pas changer le nom constant de cet objet ni supprimer son stockage pour réinitialiser un quota.

## Adaptateurs Faded Page et epubBooks

Les deux sources suivent le parcours public proposé par leur site. Le relais ne reçoit pas d’URL distante arbitraire : il construit les chemins officiels à partir d’identifiants validés. Il ne transmet aucun cookie, jeton ou en-tête d’authentification du lecteur. Les seuls cookies utilisés sont créés par le fournisseur pour une acquisition anonyme et sont abandonnés en fin d’opération. Une redirection inattendue, un refus d’accès ou un challenge arrête le parcours, sans changement de domaine ou tentative de contournement.

Faded Page utilise un POST de formulaire à `csearc2.php` pour les recherches explicitement lancées par un lecteur. Son `robots.txt` exclut ce backend de l’indexation ; aucune exploration globale ni préchargement de livres n’est implémenté. Les recherches vides ne contactent pas le fournisseur. Les réponses JSON sont limitées à 2 Mio, nettoyées de leurs biographies et mises en cache cinq minutes ; le Worker garde au maximum deux recherches. La pagination de 24 lignes utilise ce résultat borné déjà reçu. Les acquisitions passent d’abord par `showbook.php?pid=...`, vérifient la présence du lien EPUB puis réutilisent uniquement la session PHP anonyme de cette fiche vers `link.php?file=....epub`. Le délai maximal est de 45 secondes ; le handler accepte deux recherches simultanées et un EPUB à la fois. Son cache de livres est réduit à 4 Mio dans le Worker.

epubBooks utilise la recherche HTML publique `GET /search?q=...`. La fiche d’édition annonce un identifiant EPUB ; le relais suit le POST public de création du téléchargement puis le GET du fichier, avec le cookie anonyme émis pour cette opération. Les réponses HTML sont limitées à 2 Mio et les EPUB à 30 Mio, avec un délai de 35 secondes. Les recherches ont un cache de cinq minutes, limité par défaut à quatre entrées et 4 Mio cumulés, et resserré à deux entrées et 2 Mio dans le Worker ; aucun EPUB n’est conservé dans un cache serveur propre à cet adaptateur. Le handler accepte deux recherches, un EPUB et deux couvertures simultanés dans des limites distinctes. La route de couverture demande uniquement l’image annoncée par la fiche : JPEG ou PNG validé, 1 Mio au maximum et quatre secondes de délai. Son échec n’empêche pas la lecture du livre importé.

Les bibliothèques et archives personnelles restent dans IndexedDB. Les adaptations du relais doivent être publiées avant une interface Pages qui dépend de nouvelles routes ; une simple publication des fichiers statiques ne met pas à jour le Worker.

## Pipeline

Le job `deploy-sources` du dépôt déploie ce Worker automatiquement quand **`vars.SOURCE_RELAY_DEPLOY_ENABLED == 'true'`**. Fournir au job `CLOUDFLARE_API_TOKEN` via les secrets GitHub et `CLOUDFLARE_ACCOUNT_ID` via les variables GitHub, puis exécuter Wrangler 4.131.1. Le job doit attendre les vérifications unitaires et navigateur, puis contrôler l’URL publique avant le build Pages qui utilise `VITE_SOURCE_RELAY_URL`. Le service actuel a été publié avec la connexion OAuth locale disponible. Le job automatique reste désactivé tant qu’un jeton CI n’est pas configuré ; cela n’empêche pas le déploiement automatique de l’interface Pages vers le service existant. Une connexion OAuth locale ne doit jamais être copiée dans le dépôt ou les logs du pipeline.

Pour un serveur Node existant, `npm start` expose les mêmes routes. Définir `SOURCE_ALLOWED_ORIGIN` lorsque le client est sur une autre origine, et utiliser HTTPS en production. En cas de plusieurs instances Node, le callback de réservation ELG doit partager et persister ses quotas ; le déploiement Durable Object fourni satisfait déjà ce point.
