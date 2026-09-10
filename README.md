# EPUB FastReader

Un lecteur EPUB conçu d’abord pour le téléphone, également utilisable sur tablette et PC. Le site démarre en **sombre**, avec le mode **Mot à mot** sélectionné. Chaque utilisateur peut choisir le thème clair ou sépia et passer en Classique ou Focus.

**Tout l’espace personnel reste dans la base IndexedDB du navigateur** : livres, fichiers EPUB originaux, positions, marque-pages, notes et réglages. Aucun compte ni base de données personnelle sur serveur n’est nécessaire. Un petit serveur HTTP récupère uniquement les livres publics demandés dans les catalogues. « Ma bibliothèque » rassemble tous les livres ouverts ; l’ancien lien `#account` y redirige.

## Utilisation

- **Ma bibliothèque** : trois suggestions de livres à ouvrir immédiatement, reprise de la dernière lecture, import et suppression d’EPUB.
- **Recherche commune** : une seule barre reste en haut de la bibliothèque et de Découvrir. Elle cherche par titre/auteur dans vos livres et les sources en parallèle. Vos livres apparaissent d’abord, avec ouverture directe et progression ; les éditions déjà enregistrées ne sont pas répétées dans les résultats des catalogues. La langue et les sources filtrent uniquement les catalogues.
- **Découvrir** : rechercher un titre ou un auteur, puis toucher une couverture pour récupérer l’EPUB, l’ajouter à la bibliothèque et ouvrir le lecteur. Ce parcours concerne toute la sélection et les résultats Gutenberg. Une édition déjà présente reprend sa position sans nouveau téléchargement. La recherche s’effectue localement dans l’index officiel, sans appel à Gutendex.
- **Lire** : trois modes visibles, démarrage et pause explicites, retour/avance de dix mots, cadence de 100 à 800 mots/minute, navigation par chapitre, taille et police réglables.
- **Mes repères** : marque-page automatique, signets, recherche de passages dans le livre, surlignages, notes modifiables et export Markdown.
- **Exporter** : récupérer son EPUB original ou une version Focus.
- **Hors connexion** : les livres importés, la sélection et la recherche française sont disponibles après installation complète du cache. Les autres langues sont conservées dans le cache après leur première consultation.

Validez la recherche avec **Entrée** ou la loupe. Le lien de recherche conserve la requête, la langue, la source et la page pour le rechargement et le retour arrière. **Effacer la recherche** affiche tous vos livres et les catalogues dans la langue choisie. Un changement de page ou un clic sur la page active ramène en haut ; le passage enregistré dans le lecteur est conservé.

Les suggestions se renouvellent au démarrage de l’application et avec **D’autres idées**. Elles privilégient les œuvres absentes de la bibliothèque, puis celles à commencer, en variant les auteurs et les genres. La dernière sélection est enregistrée dans IndexedDB pour éviter les répétitions lorsque d’autres titres conviennent ; elle reste stable pendant la navigation et les changements de thème. Afficher une suggestion n’ajoute pas le livre à la bibliothèque.

La scène Mot à mot garde une hauteur fixe ; la longueur du contexte ne déplace plus le mot ni les commandes. Les tokens longs sont ajustés à la largeur disponible. En **Focus**, les préfixes utilisent une graisse de 900 et une couleur distincte ; les couleurs du texte et des surlignages visent au moins 4,5:1 de contraste avec leur fond dans les trois thèmes. Aucun mode ne garantit une augmentation de vitesse ou de compréhension.

Les couvertures typographiques du catalogue restent identiques dans les suggestions, Découvrir et Mes livres : couleurs, titre et auteur ne sont plus remplacés par les métadonnées ou l’image interne de l’EPUB après import. Les EPUB personnels gardent leur propre image de couverture. Les octets originaux de chaque fichier sont conservés.

Les neuf éditions intégrées restent disponibles après installation du cache. Les autres EPUB Gutenberg nécessitent une première connexion : le serveur les récupère auprès de miroirs figurant dans la liste officielle, en privilégiant l’édition texte légère fournie par Gutenberg. Il conserve les fichiers et leurs licences sans les modifier. En cas de panne, l’interface propose **Réessayer**, la fiche source et l’import manuel. Les droits annoncés par le catalogue concernent les États-Unis ; vérifier ceux de son pays. [Sources et limites vérifiées](docs/SOURCES.md).

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

`npm run dev` et `npm run preview` comprennent le relais de téléchargement. Pour servir la version compilée avec le serveur de production : `npm run build`, puis `npm start`. Un hébergement purement statique ne suffit pas pour les téléchargements Gutenberg ; le lecteur et les données personnelles restent dans le navigateur.

Playwright teste Chromium et WebKit avec des profils PC, téléphone et tablette, plus des écrans mobiles étroits et le paysage. Les essais automatisés ne remplacent pas des tests sur le matériel réel.

Raccourcis du lecteur : **Espace** démarre/met en pause le mot à mot, **← / →** changent de chapitre, **Échap** ferme le panneau ouvert. Les champs et boutons gardent leur comportement clavier habituel.

## Données et migration

La base `fastreader` passe en version 2 sans supprimer ses livres ni ses positions. Les anciens réglages de police et de cadence sont migrés depuis localStorage vers IndexedDB. Cette refonte applique une fois les nouveaux choix initiaux sombre/Mot à mot ; les choix effectués ensuite sont conservés.

La base reste propre au navigateur et à l’origine du site. Elle n’est pas partagée automatiquement entre téléphone et PC. Garder les EPUB originaux : effacer les données du site ou utiliser une navigation privée peut rendre la bibliothèque indisponible. [Organisation du stockage](docs/STORAGE.md).

L’import accepte les EPUB sans DRM, jusqu’à 30 Mio. Il suit l’ordre de lecture de l’archive, conserve le fichier original et nettoie le contenu affiché avec DOMPurify. Scripts, styles du livre, ressources distantes et contenus actifs sont écartés. Les formats à mise en page fixe, SVG, MathML, audio et vidéo ne sont pas pleinement pris en charge. L’export Focus simplifie la présentation.

Le stockage `EpubDatabase` du prototype historique n’est pas migré. Les lecteurs de ce prototype doivent réimporter leurs EPUB ; la bibliothèque `fastreader` des versions récentes est conservée.

## Sources, maintenance et déploiement

Les plugins sont des modules de sources versionnés dans `src/sources/`. L’index Gutenberg est un instantané du catalogue officiel, construit avec le statut de droits et les formats réellement proposés, puis découpé par langue en fichiers portant l’empreinte de leur contenu. [Provenance et mise à jour](docs/SOURCES.md).

Le pipeline GitHub Actions installe les versions verrouillées, audite les dépendances de production, exécute les tests, compile et teste les navigateurs avant de publier l’image Docker complète sur GHCR depuis la branche par défaut. Un hook de déploiement peut ensuite être configuré pour l’hébergeur choisi. [Activation du déploiement](docs/DEPLOYMENT.md).

| Fichiers                                           | Responsabilité                                            |
| -------------------------------------------------- | --------------------------------------------------------- |
| `src/main.js`, `src/views/`, `src/styles.css`      | Parcours, vues et interface adaptable                     |
| `src/epub.js`                                      | Import, nettoyage et export EPUB                          |
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

Le [rapport page par page](docs/AUDIT-PAGES.md) décrit les parcours, les défauts corrigés et leur couverture. Les résultats réellement exécutés sont dans [VALIDATION.md](docs/VALIDATION.md). Les recherches sur la lecture sont dans [READING-UX.md](docs/READING-UX.md). Les [améliorations proposées](docs/AMELIORATIONS.md) priorisent les prochaines fonctionnalités ; [ROADMAP.md](docs/ROADMAP.md) conserve la feuille de route générale.

Licence du code : [MIT](LICENSE). Les EPUB conservent leurs propres crédits, droits et licences.
