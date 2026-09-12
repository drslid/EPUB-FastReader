# EPUB FastReader

Un lecteur EPUB conçu d’abord pour le téléphone, également utilisable sur tablette et PC. Le site et le lecteur démarrent en **Sépia**, avec **Verdana**. Chaque ouverture commence en **Mot à mot**, sans lecture automatique ; la préférence système de réduction des mouvements choisit Classique. L’ordre des modes est Mot à mot, Focus, Classique. Les choix de thème et les réglages de confort restent enregistrés.

**Tout l’espace personnel reste dans la base IndexedDB du navigateur** : livres, fichiers EPUB originaux, positions, marque-pages, notes et réglages. Aucun compte ni base de données personnelle sur serveur n’est nécessaire. Un petit serveur HTTP récupère uniquement les livres publics demandés dans les catalogues. « Ma bibliothèque » rassemble les EPUB importés ou obtenus depuis les sources ; la démonstration reste sur l’accueil. L’ancien lien `#account` redirige vers la bibliothèque.

## GitHub Pages et version serveur

Le site est publié sur [GitHub Pages](https://drslid.github.io/EPUB-FastReader/). **Lire** télécharge l’EPUB, l’enregistre dans IndexedDB et ouvre le lecteur. Une édition déjà enregistrée reprend sa position sans téléchargement.

La sélection intégrée est servie avec le site. Standard Ebooks fonctionne directement depuis le navigateur ; Gutenberg et Ebooks libres et gratuits utilisent le [service FastReader](https://fastreader-sources.carbonnier-anthony.workers.dev/api/sources/status). Le build Pages reçoit cette adresse via `VITE_SOURCE_RELAY_URL`. La version Node/Docker expose les mêmes routes. Une installation Pages sans relais conserve un repli explicite pour Gutenberg ; elle ne prétend pas pouvoir ouvrir un fichier inaccessible.

## Utilisation

- **Langues** : français, anglais, espagnol, italien, allemand et portugais, avec drapeaux et noms de langues. Le choix d’interface est mémorisé ; le texte des livres garde sa langue originale. Les six pages publiques disposent de métadonnées traduites et d’un sitemap. [Langues et référencement](docs/MULTILINGUAL-SEO.md).
- **Accueil** : trois suggestions renouvelables, démonstration et aide facultative sur les trois modes.
- **Ma bibliothèque** : uniquement les livres enregistrés, reprise de la dernière lecture, import, suppression et exports EPUB Classique/Focus.
- **Recherche commune** : une seule barre reste en haut de la bibliothèque et de Découvrir. Elle cherche par titre/auteur dans vos livres et les sources en parallèle. Vos livres apparaissent d’abord, avec ouverture directe et progression ; les éditions déjà enregistrées ne sont pas répétées dans les résultats des catalogues. La langue et les sources filtrent uniquement les catalogues.
- **Découvrir** : rechercher un titre ou un auteur, puis toucher une couverture. Les livres intégrés ouvrent immédiatement le lecteur ; une édition déjà présente reprend sa position sans nouveau téléchargement. Gutenberg est recherché dans l’index officiel local ; Standard Ebooks et Ebooks gratuits sont interrogés en parallèle dans leur langue. Les résultats arrivent au fil des réponses, même si une source est lente. Chaque carte indique sa provenance.
- **Lire** : trois modes, retour à la phrase précédente ou de dix mots, cadence Souple/Régulière de 100 à 800 mots/minute, maintien facultatif de l’écran allumé et sommaire directement accessible.
- **Disponibilité** : le panneau Paramètres affiche les sources avec un état rouge/vert accompagné de texte, un contrôle actualisable et un rappel des droits selon le pays. Z-Library est signalé comme non intégré : les essais n’ont pas permis de vérifier une recherche et une acquisition automatisées. Open SLUM reste un lien externe.
- **Réglages** : profils Équilibré/Confort/Focus léger, aperçu immédiat, taille, six familles de polices locales, interligne, largeur de texte et intensité Focus ; option pour épargner les mots courts.
- **Mes repères** : marque-page automatique, signets, recherche de passages dans le livre, surlignages, notes modifiables et export Markdown.
- **Exporter** : récupérer son EPUB original inchangé, une version Classique nettoyée ou une version Focus. Les éditions ELG sont proposées en original uniquement, afin de conserver les conditions variables de leurs éditeurs.
- **Sauvegarder** : exporter un ZIP de la bibliothèque et de ses repères, puis le restaurer sans compte. Limites : 500 livres et 250 Mio par sauvegarde. Le panneau affiche aussi l’espace estimé et une demande facultative de protection du stockage.
- **Mettre à jour** : un bandeau PWA propose la nouvelle version après sauvegarde de la lecture, avec possibilité de reporter.
- **Hors connexion** : les six langues de l’interface, les livres importés, la sélection et la recherche française sont disponibles après installation complète du cache. Les catalogues des autres langues sont conservés après leur première consultation.

Validez la recherche avec **Entrée** ou la loupe. Le lien de recherche conserve la requête, la langue, la source et la page pour le rechargement et le retour arrière. **Effacer la recherche** affiche tous vos livres et les catalogues dans la langue choisie. Un changement de page ou un clic sur la page active ramène en haut ; le passage enregistré dans le lecteur est conservé.

Les suggestions se renouvellent au démarrage de l’application et avec **D’autres idées**. Elles privilégient les œuvres absentes de la bibliothèque, puis celles à commencer, en variant les auteurs et les genres. La dernière sélection est enregistrée dans IndexedDB pour éviter les répétitions lorsque d’autres titres conviennent ; elle reste stable pendant la navigation et les changements de thème. Afficher une suggestion n’ajoute pas le livre à la bibliothèque.

La scène Mot à mot garde une hauteur fixe ; la longueur du contexte ne déplace plus le mot ni les commandes. Les tokens longs sont ajustés à la largeur disponible. En **Focus**, les préfixes utilisent une graisse de 700 et des couleurs rapprochées ; les couleurs du texte et des surlignages visent au moins 4,5:1 de contraste avec leur fond dans les trois thèmes. Aucun mode ne garantit une augmentation de vitesse ou de compréhension.

Les couvertures typographiques du catalogue restent identiques dans les suggestions, Découvrir et Mes livres : couleurs, titre et auteur ne sont plus remplacés par les métadonnées ou l’image interne de l’EPUB après import. Les EPUB personnels gardent leur propre image de couverture. Les titres longs et auteurs sont affichés intégralement, avec retour à la ligne et taille adaptée ; l’auteur remplace la signature décorative. Les octets originaux de chaque fichier sont conservés.

Les neuf éditions intégrées restent disponibles après installation du cache. Les autres EPUB Gutenberg nécessitent une première connexion. Le relais FastReader les récupère auprès de miroirs figurant dans la liste officielle, en privilégiant l’édition texte légère fournie par Gutenberg. Il conserve les fichiers et leurs licences sans les modifier. En cas de panne, l’interface propose **Réessayer**, la fiche source et l’import manuel. Les droits annoncés par le catalogue concernent les États-Unis ; vérifier ceux de son pays. [Sources et limites vérifiées](docs/SOURCES.md).

## Démarrer et vérifier

Node.js 22.13+ dans la branche 22, Node 24 ou Node 26+.

```sh
npm ci
npm run dev
```

Le serveur affiche son adresse locale et réseau. Pour vérifier la version compilée et son fonctionnement hors connexion :

```sh
npm test
npm run build
npx playwright install --with-deps chromium webkit
npm run test:e2e
npm run preview
```

`npm run dev` et `npm run preview` comprennent le relais de téléchargement. Pour servir la version compilée avec le serveur de production : `npm run build`, puis `npm start`. Le build Pages reçoit `VITE_SOURCE_RELAY_URL` pour les téléchargements directs ; le lecteur et les données personnelles restent dans le navigateur.

Playwright teste Chromium et WebKit avec des profils PC, téléphone et tablette, plus des écrans mobiles étroits et le paysage. Les essais automatisés ne remplacent pas des tests sur le matériel réel.

Raccourcis du lecteur : **Espace** démarre/met en pause le mot à mot, **← / →** changent de chapitre, **Échap** ferme le panneau ouvert. Les champs et boutons gardent leur comportement clavier habituel.

## Données et migration

La base `fastreader` passe en version 2 sans supprimer ses livres ni ses positions. Les anciens réglages de police et de cadence sont migrés depuis localStorage vers IndexedDB. Les nouveaux réglages par défaut sont Sépia/Verdana. Les thèmes déjà choisis sont conservés ; chaque ouverture applique le mode initial décrit ci-dessus.

La base reste propre au navigateur et à l’origine du site. Elle n’est pas partagée automatiquement entre téléphone et PC. Le ZIP de sauvegarde permet un transfert manuel ; la restauration conserve les données déjà présentes et ne remplace les réglages que sur demande. Garder ce ZIP et les EPUB originaux hors du navigateur : effacer les données du site ou utiliser une navigation privée peut rendre la bibliothèque indisponible. [Organisation du stockage](docs/STORAGE.md).

L’import accepte les EPUB sans DRM, jusqu’à 30 Mio. Il suit l’ordre de lecture de l’archive, conserve le fichier original et nettoie le contenu affiché avec DOMPurify. Scripts, styles du livre, ressources distantes et contenus actifs sont écartés. Les formats à mise en page fixe, SVG, MathML, audio et vidéo ne sont pas pleinement pris en charge. Les exports Classique et Focus simplifient la présentation. La décompression ZIP s’effectue dans un Web Worker, avec progression par chapitre et solution de repli. Le nettoyage du DOM reste sur le fil principal et tous les chapitres sont préparés à l’import ; les gros contenus peuvent encore occasionner des pauses.

Le stockage `EpubDatabase` du prototype historique n’est pas migré. Les lecteurs de ce prototype doivent réimporter leurs EPUB ; la bibliothèque `fastreader` des versions récentes est conservée.

## Sources, maintenance et déploiement

Les plugins sont des modules de sources versionnés dans `src/sources/`. Standard Ebooks et Ebooks libres et gratuits ont été intégrés après validation. Toute source supplémentaire sera étudiée et validée avant intégration. L’index Gutenberg est un instantané du catalogue officiel, construit avec le statut de droits et les formats réellement proposés, puis découpé par langue en fichiers portant l’empreinte de leur contenu. [Provenance et mise à jour](docs/SOURCES.md).

Le pipeline GitHub Actions installe les versions verrouillées, audite les dépendances de production, exécute les tests, compile et teste les navigateurs. Depuis la branche par défaut, il valide aussi le build statique sous le chemin du dépôt puis le publie automatiquement sur GitHub Pages. Il publie en parallèle l’image Docker complète sur GHCR. Un hook de déploiement peut ensuite être configuré pour l’hébergeur choisi. [Activation du déploiement](docs/DEPLOYMENT.md).

| Fichiers                                           | Responsabilité                                            |
| -------------------------------------------------- | --------------------------------------------------------- |
| `src/main.js`, `src/views/`, `src/styles.css`      | Parcours, vues et interface adaptable                     |
| `src/epub.js`, `src/epub-archive*`                  | Import, Worker ZIP, nettoyage et exports EPUB             |
| `src/backup*`                                     | Sauvegarde ZIP, restauration et espace local              |
| `src/reading-comfort.js`, `src/reading-preferences.js` | Cadence, Wake Lock et profils de lecture                 |
| `src/storage.js`, `src/reading-state.js`           | Données personnelles et validation                        |
| `src/reading-location.js`, `src/passage-search.js` | Positions stables, annotations et recherche dans le livre |
| `src/catalog.js`, `src/sources/`, `scripts/`       | Plugins, recherche et génération du catalogue             |
| `src/suggestions.js`, `src/views/suggestions.js`   | Choix local des suggestions et présentation de l’accueil  |
| `src/search-results.js`, `src/search-route.js`, `src/views/search.js`, `src/search.css` | Recherche commune, classement local, liens et bandeau fixe |
| `src/covers.js`                                    | Présentation commune des couvertures et anciens imports   |
| `server/`, `Dockerfile`                            | Serveur HTTP et récupération des EPUB publics              |
| `public/books/`, `public/catalog/`                 | Éditions intégrées, provenance et index                   |
| `public/sw.js`, `vite.config.js`                   | Cache hors connexion et compilation                       |
| `.github/workflows/deploy.yml`                     | Contrôles et publication automatique                      |

Le [rapport des nouvelles fonctionnalités, page par page](docs/EVOLUTION-LECTURE.md) décrit cet incrément, ses vérifications et ses limites, ainsi que deux pistes audio locales à écouter (Kokoro/Piper, non intégrées). Le [rapport précédent](docs/AUDIT-PAGES.md) conserve l’historique des parcours et des défauts corrigés. Les résultats réellement exécutés sont dans [VALIDATION.md](docs/VALIDATION.md). Les recherches sur la lecture sont dans [READING-UX.md](docs/READING-UX.md). Les [améliorations proposées](docs/AMELIORATIONS.md) priorisent les prochaines fonctionnalités ; [ROADMAP.md](docs/ROADMAP.md) conserve la feuille de route générale.

Licence du code : [MIT](LICENSE). Les EPUB conservent leurs propres crédits, droits et licences.

Les recherches externes sont transmises aux catalogues concernés ; les livres personnels, repères et notes restent locaux. ELG impose un accès mesuré : 50 tentatives de téléchargement sur 24 heures pour le relais, avec un intervalle minimal et un traitement séquentiel. Une limite atteinte affiche une erreur claire, les autres sources restent utilisables. [Audit ELG](docs/SOURCE-EBOOKS-GRATUITS.md) · [Déploiement du relais](docs/SOURCE-RELAY-DEPLOYMENT.md).
