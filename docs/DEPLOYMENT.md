# Déploiement et fonctionnement hors ligne

## GitHub Pages

L'application possède une version statique destinée à [GitHub Pages](https://drslid.github.io/EPUB-FastReader/). Elle conserve la bibliothèque personnelle, la recherche unifiée, les couvertures, les trois modes de lecture et les données enregistrées dans le navigateur. Les neuf livres intégrés s'ouvrent en un clic. Pour les autres livres Gutenberg, la recherche présente la source officielle et permet de télécharger l'EPUB puis de l'importer dans le lecteur.

GitHub Pages héberge des fichiers statiques et ne peut pas exécuter le relais Node de téléchargement. Sans relais externe configuré, la version Pages présente ce parcours d'import et n'appelle pas une API absente. Le téléchargement direct des autres EPUB Gutenberg est disponible avec le serveur complet ci-dessous, ou en raccordant explicitement ce serveur à Pages. [Fonctionnement de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

Pour compiler et vérifier cette version localement :

```sh
npm ci
npm run build:pages
npx playwright install --with-deps chromium
npm run test:pages
```

`build:pages` produit `dist-pages`. Le test sert ces fichiers sous `/EPUB-FastReader/`, sans relais, pour vérifier le comportement de l'hébergement statique. Les URL relatives permettent aussi d'utiliser un domaine personnalisé. La production Node utilise son propre dossier `dist` et conserve les téléchargements directs.

## Relier Pages aux téléchargements

Le relais public FastReader est déployé à `https://fastreader-sources.carbonnier-anthony.workers.dev`. La variable GitHub `VITE_SOURCE_RELAY_URL` est injectée au build Pages et dans sa vérification statique. [Configuration du Worker et limites des sources](SOURCE-RELAY-DEPLOYMENT.md). Les exemples ci-dessous restent utiles pour un autre hébergement.

Sur le serveur Node/Docker, définir l'origine exacte de l'interface :

```sh
GUTENBERG_ALLOWED_ORIGIN=https://drslid.github.io npm start
```

Une origine ne comprend pas le chemin `/EPUB-FastReader/`, ni de barre finale. Le serveur refuse une configuration HTTP, un joker `*`, une URL avec identifiants ou un chemin. Les requêtes provenant d'une autre origine sont refusées avant de contacter Gutenberg. Les réponses autorisées portent `Access-Control-Allow-Origin` et `Vary: Origin`, sans autorisation des cookies. Les précontrôles OPTIONS acceptent seulement GET/HEAD et l'en-tête Accept ; ils ne téléchargent aucun EPUB. Les autres routes ne deviennent pas accessibles en CORS. Cette règle concerne les navigateurs ; elle ne constitue pas une authentification d'un service public. [Fonctionnement de CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS).

À la compilation Pages, indiquer l'URL de base HTTPS de ce serveur :

```sh
VITE_SOURCE_RELAY_URL=https://relais.example.fr npm run build:pages
```

Le client construit lui-même `https://relais.example.fr/api/books/gutenberg/5711.epub` à partir de l'identifiant Gutenberg. La configuration peut inclure un sous-chemin, par exemple `https://relais.example.fr/lecteur` ; le reverse proxy doit alors retirer `/lecteur` avant de transmettre les requêtes à Node. Ne pas ajouter `/api/books/gutenberg` dans la variable. Les paramètres d'URL, fragments, identifiants et chemins ambigus sont refusés. Une valeur absente ou invalide conserve le parcours manuel sur Pages. L'URL du relais est publique dans le JavaScript compilé : ce n'est pas un secret et elle ne doit contenir aucun jeton.

Dans GitHub Actions, la variable de dépôt `GUTENBERG_RELAY_URL` peut être transmise comme variable d'environnement `VITE_GUTENBERG_RELAY_URL` à l'étape de compilation Pages. Il faut ensuite recompiler et publier l'interface ; changer uniquement la variable du serveur ne modifie pas une version statique déjà publiée. Conserver cette variable vide tant que l'hébergement n'est pas validé.

Avant activation, vérifier le précontrôle depuis l'origine exacte, puis un téléchargement depuis le navigateur Pages :

```sh
curl -i -X OPTIONS 'https://relais.example.fr/api/books/gutenberg/5711.epub' \
  -H 'Origin: https://drslid.github.io' \
  -H 'Access-Control-Request-Method: GET'
```

Le résultat attendu est HTTP 204 avec `Access-Control-Allow-Origin: https://drslid.github.io`. Vérifier aussi qu'une autre origine obtient HTTP 403, que le clic « Lire » importe réellement l'EPUB et qu'une panne du relais laisse accessible le téléchargement officiel. Le relais ne reçoit ni EPUB personnel, ni position, ni annotation ; seul le livre public demandé transite par lui. Les protections existantes restent actives : identifiant numérique obligatoire, miroirs fixes, aucune redirection suivie, limites de taille et durée, cache et concurrence bornés.

Le raccordement compilé peut être vérifié sans hébergement supplémentaire :

```sh
npm run test:pages:relay
FASTREADER_RELAY_BROWSER=webkit npm run test:pages:relay
```

Ce script compile Pages dans un dossier temporaire avec `https://relay.fastreader.test`, sert l'application sous `/EPUB-FastReader/` et intercepte les réponses du relais avec un EPUB de test. Il ne modifie ni `dist`, ni `dist-pages`, ni une configuration de production. Le parcours vérifie les octets importés, la position exacte et le signet, la reprise sans téléchargement, le repli après HTTP 403 sans ajout dans la bibliothèque, le rechargement hors ligne après arrêt du serveur, et l'absence d'appels à une API sur Pages ou à un vrai service distant.

Validation observée le 12 septembre 2026 : six vérifications réussies sur Chromium et six sur WebKit. Pour contourner les limites d'interception de Playwright WebKit, le script diffère la première inscription du service worker jusqu'à la fin des téléchargements simulés, puis teste son installation et le rechargement réellement servi depuis son cache. La coupure WebKit est provoquée par l'arrêt du serveur, avec une requête réseau de contrôle en échec. Ces résultats valident le raccordement logiciel ; la disponibilité et les en-têtes du futur hébergeur restent à vérifier avant activation.

## Serveur complet

La recherche reste locale. Télécharger un EPUB Gutenberg à partir de sa couverture utilise un relais public dans `server/gutenberg-relay.js`.

Le serveur ne demande aucun compte, ne reçoit pas d’EPUB personnel et ne conserve pas de bibliothèque utilisateur. Il récupère uniquement des fichiers publics sur les miroirs Gutenberg autorisés. Livres, positions, notes et réglages restent dans IndexedDB sur l’appareil. Son cache mémoire contient seulement les fichiers publics demandés, avec une limite de 64 Mio et une expiration de six heures.

## Développement, vérification et lancement

Node 22.13+ dans la branche 22, Node 24 ou Node 26+ ; dépendances fixées dans `package-lock.json`.

```sh
npm ci
npm run dev
npm test
npm run build
npx playwright install --with-deps chromium webkit
npm run test:e2e
npm start
```

Les serveurs Vite de développement et d’aperçu incluent le même relais. `npm start` lance le serveur de production Node sur `0.0.0.0:4173` ; `PORT` et `HOST` peuvent être configurés par l’hébergeur. `/api/health` fournit un contrôle de disponibilité sans requête Gutenberg. Le serveur sert les fichiers de `dist`, avec leurs types MIME, les méthodes GET/HEAD et une protection contre les chemins sortant du dossier public.

Utiliser un domaine HTTPS, avec le serveur à la racine. Derrière un reverse proxy et un sous-chemin, retirer ce préfixe pour les requêtes transmises au serveur, y compris `/api/books/gutenberg/…`. Les chemins des ressources du navigateur restent relatifs. `vite preview` sert aux vérifications, pas à l’hébergement public.

## Conteneur

```sh
docker build -t fastreader .
docker run -d --name fastreader --restart unless-stopped -p 4173:4173 fastreader
```

Le Dockerfile compile l’interface, puis copie le serveur et la production dans une image Node minimale, exécutée avec l’utilisateur `node`. Aucune dépendance npm n’est nécessaire à l’exécution du relais. Aucun volume contenant des données personnelles n’est requis. Placer un reverse proxy HTTPS devant le conteneur pour un accès public.

## Pipeline automatique

`.github/workflows/deploy.yml` vérifie le projet, publie la version GitHub Pages et conserve la publication du serveur complet :

1. Chaque push et pull request installe les dépendances verrouillées, audite les dépendances de production, lance les tests unitaires, compile puis exécute les parcours navigateur.
2. Après réussite sur la branche par défaut, `build-pages` compile `dist-pages`, installe Chromium, lance `npm run test:pages` puis transmet les fichiers vérifiés à `deploy-pages`. Ce dernier publie dans l'environnement `github-pages`, avec les permissions `pages: write` et `id-token: write` limitées à ce job. Les déploiements sont sérialisés ; une ancienne révision n'est pas publiée si la branche par défaut contient déjà un commit plus récent. Un lancement manuel depuis l'onglet Actions suit les mêmes vérifications et reste limité à la branche par défaut. [Workflows GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
3. En parallèle de la version Pages, le pipeline construit et publie l'image complète `ghcr.io/<propriétaire>/<dépôt>` avec deux tags : le SHA du commit et `latest`. Le jeton GitHub de publication est limité au job concerné. [Registre de conteneurs GitHub](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
4. Pour un déploiement automatique sur un hébergeur compatible avec les conteneurs et un webhook POST, configurer cet hébergeur avec cette image, le port 4173 et le contrôle `/api/health`. Enregistrer son URL HTTPS de déploiement dans le secret GitHub **DEPLOY_HOOK_URL**, puis définir la variable **DEPLOY_HOOK_ENABLED=true**. Le job `deploy` appelle le webhook après publication. Configurer aussi l'accès au registre si l'image est privée.

Dans les réglages du dépôt, **Settings → Pages → Build and deployment → Source** doit être réglé sur **GitHub Actions**. La version Pages ne nécessite ni secret de déploiement ni hébergeur supplémentaire ; son URL figure dans le job `deploy-pages`. Une pull request ne publie aucune version. La réussite de la compilation seule ne confirme pas un déploiement : vérifier le job de publication et l'URL du site.

Sans webhook configuré, seul le déploiement sur un hébergeur Node/Docker est désactivé ; GitHub Pages reste publié par son propre job. Le succès du webhook indique l'acceptation du déclenchement ; le résultat final doit être contrôlé sur l'hébergeur.

Conserver les tags SHA pour revenir à une version précise. Pour annuler un changement, déployer son image précédente ou pousser un commit correctif. Une migration de domaine ne transfère pas la base du navigateur : conserver l’origine du site quand c’est possible.

## Installation et lecture hors ligne

Le service worker nécessite HTTPS ou localhost. Le build précache le lecteur, les neuf EPUB intégrés, leurs notices et l’index français. Les autres langues sont mises en cache à leur première consultation. Le catalogue peut donc rester recherchable hors connexion alors qu’un livre distant n’a pas encore été téléchargé : l’interface explique qu’une première connexion est nécessaire.

Après import, l’EPUB Gutenberg et sa progression restent dans IndexedDB, indépendamment du cache temporaire du serveur. Aucun téléchargement au relais n’est nécessaire pour reprendre ce livre. Les icônes d’installation et Apple sont fournies ; `npm run icons:generate` permet de les régénérer après modification du SVG source.

Une nouvelle version déclenche un bandeau « Mettre à jour ». L’application sauvegarde la lecture et les préférences avant d’activer la version téléchargée ; un échec de sauvegarde reporte la mise à jour. IndexedDB n’est pas effacé. Les installations plus anciennes dépourvues de ce bandeau peuvent encore nécessiter la fermeture de tous les onglets FastReader avant réouverture. Une aide d’installation reste disponible lorsque le navigateur ne propose pas d’invitation native, notamment sur iPhone/iPad.

Les tests émulent PC, téléphone Chromium et tablette WebKit. Le scénario hors ligne WebKit coupe un serveur HTTP isolé pour éviter un défaut de l’émulation réseau dans cet environnement. Les tests n’établissent pas à eux seuls le comportement sur tous les appareils physiques. Voir [VALIDATION.md](VALIDATION.md) et [STORAGE.md](STORAGE.md).
