# Déploiement et fonctionnement hors ligne

## Serveur complet

La recherche reste locale. Télécharger un EPUB Gutenberg à partir de sa couverture utilise désormais un relais public dans `server/gutenberg-relay.js`. **Le site doit être servi avec ce relais** ; publier uniquement `dist` sur GitHub Pages ne suffit plus pour ce parcours. GitHub Pages est un hébergement statique : [documentation officielle](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

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

`.github/workflows/deploy.yml` remplace l’ancien déploiement statique Pages :

1. Chaque push et pull request installe les dépendances verrouillées, audite les dépendances de production, lance les tests unitaires, compile puis exécute les parcours navigateur.
2. Après réussite sur la branche par défaut, le pipeline construit et publie l’image complète `ghcr.io/<propriétaire>/<dépôt>` avec deux tags : le SHA du commit et `latest`. Le jeton GitHub de publication est limité au job concerné. [Registre de conteneurs GitHub](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
3. Pour un déploiement automatique sur un hébergeur compatible avec les conteneurs et un webhook POST, configurer cet hébergeur avec cette image, le port 4173 et le contrôle `/api/health`. Enregistrer son URL HTTPS de déploiement dans le secret GitHub **DEPLOY_HOOK_URL**, puis définir la variable **DEPLOY_HOOK_ENABLED=true**. Le job `deploy` appelle le webhook après publication. Configurer aussi l’accès au registre si l’image est privée.

Sans hébergeur et webhook configurés, le pipeline vérifie et publie l’image ; il ne déploie pas de site public. La création de ces fichiers n’effectue aucun push, aucune publication d’image ni aucun déploiement. Les credentials et l’hébergeur doivent être configurés une fois. Le succès d’un webhook indique l’acceptation du déclenchement ; le résultat final doit être contrôlé sur l’hébergeur.

Conserver les tags SHA pour revenir à une version précise. Pour annuler un changement, déployer son image précédente ou pousser un commit correctif. Une migration de domaine ne transfère pas la base du navigateur : conserver l’origine du site quand c’est possible.

## Installation et lecture hors ligne

Le service worker nécessite HTTPS ou localhost. Le build précache le lecteur, les neuf EPUB intégrés, leurs notices et l’index français. Les autres langues sont mises en cache à leur première consultation. Le catalogue peut donc rester recherchable hors connexion alors qu’un livre distant n’a pas encore été téléchargé : l’interface explique qu’une première connexion est nécessaire.

Après import, l’EPUB Gutenberg et sa progression restent dans IndexedDB, indépendamment du cache temporaire du serveur. Aucun téléchargement au relais n’est nécessaire pour reprendre ce livre. Les icônes d’installation et Apple sont fournies ; `npm run icons:generate` permet de les régénérer après modification du SVG source.

Une mise à jour du service worker attend la fermeture des anciens onglets pour éviter de mélanger deux versions. IndexedDB n’est pas effacé lors de cette mise à jour. Si une ancienne interface apparaît, fermer tous les onglets FastReader puis rouvrir l’application.

Les tests émulent PC, téléphone Chromium et tablette WebKit. Le scénario hors ligne WebKit coupe un serveur HTTP isolé pour éviter un défaut de l’émulation réseau dans cet environnement. Les tests n’établissent pas à eux seuls le comportement sur tous les appareils physiques. Voir [VALIDATION.md](VALIDATION.md) et [STORAGE.md](STORAGE.md).
