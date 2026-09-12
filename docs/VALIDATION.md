> Le bilan de la nouvelle version (361 tests unitaires, 237 scénarios navigateur, sauvegarde et relais Pages) se trouve dans [Évolution du lecteur](EVOLUTION-LECTURE.md#validation-exécutée). Le rapport ci-dessous conserve la validation de la version précédente.

# Vérification de la version du 10 septembre 2026

La validation couvre l’interface locale révisée après l’essai utilisateur. Le [rapport des pages](AUDIT-PAGES.md) associe chaque fonction visible à ses scénarios de vérification.

## Ajout du déploiement GitHub Pages

La compilation Pages a été vérifiée séparément après les essais de la version serveur ci-dessous. `npm test` passe désormais **289 tests** ; le lot de régression découverte/recherche passe **78 parcours** sur PC, téléphone et tablette émulés. Les deux compilations réussissent : `dist` pour Node et `dist-pages` pour Pages. Le pipeline exécute ensuite la suite navigateur complète avant toute publication.

`npm run test:pages` passe **8 groupes de contrôles** sur un serveur HTTP purement statique, sous `/EPUB-FastReader/`, avec Chromium à 390 px puis 320 px. Les fichiers servis incluent `main-BbYzNqex.js` et `main-CqI-EmZw.css` :

- MIME, taille, SHA-256 et intégrité ZIP des neuf EPUB originaux, icônes et manifeste ; périmètre du service worker limité au projet.
- Lecture réelle du Horla, fichier conservé dans IndexedDB, couverture identique, signet et reprise au même mot.
- Recherche commune, livre local prioritaire et absence de téléchargement répété ou de doublon.
- Résultat Germinal clairement proposé au téléchargement/import manuel, lien officiel, aucune requête vers une API absente et aucun bouton de nouvelle tentative inutile.
- Import réel de Candide depuis ce dialogue sans lui attribuer à tort l’identité de Germinal ; les trois modes de lecture restent fonctionnels.
- Recherche fixe à 320 px, absence de débordement, navigation et retour en haut.
- Rechargement hors connexion par le service worker, livres et passage conservés, recherche française et première ouverture de Trois contes depuis le cache.
- Aucune réponse HTTP en erreur ni exception JavaScript.

Le même script accepte `FASTREADER_PAGES_URL=https://drslid.github.io/EPUB-FastReader/` pour vérifier l’URL publiée dans un profil de navigateur isolé. Les autres EPUB Gutenberg suivent volontairement un parcours de téléchargement/import sur Pages ; l’ouverture automatique par relais reste propre à la compilation serveur. Le compte rendu serveur qui suit décrit la validation précédente.

## Résultats exécutés — version serveur précédente

| Contrôle                          | Résultat                                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `npm test`                        | **287 tests passent dans 17 fichiers** : EPUB, stockage, migration, recherche, positions, bibliothèque, sources, suggestions, classement et routes de recherche |
| `npm run build`                   | Compilation Vite réussie ; production utilisée par les tests navigateur                                                        |
| `npm run test:e2e -- --workers=3` | **189 tests passent** sur le serveur Node de production, sans échec, relance ni scénario ignoré ; environ 1 min 18 s           |
| Profils de navigation             | 63 parcours par profil : PC Chromium, téléphone Chromium, tablette WebKit                                                      |
| Formats supplémentaires           | 375 × 740, 320 × 640 et paysage 812 × 375                                                                                      |

`npm audit --audit-level=high` ne signale aucune vulnérabilité au moment du contrôle. `git diff --check` ne signale aucune erreur de mise en forme. Les tests unitaires couvrent aussi les données invalides, les limites des archives, les réponses catalogue malformées et l’intégrité des neuf fichiers originaux.

Le dernier passage utilise la production contenant `main-DWOjCXhN.js` et `main-CqI-EmZw.css`. Les tests ne servent pas les modules applicatifs depuis le serveur de développement. Les tests du moteur des positions chargent séparément son module pur pour mesurer une vraie géométrie de texte.

## Étendue de la vérification

- **Accueil renouvelé :** trois suggestions intégrées distinctes ; rotation au démarrage et sur demande ; historique dans IndexedDB ; aucun EPUB importé par le simple affichage ; stabilité pendant la navigation, la recherche et le choix du thème. Les tests unitaires couvrent aussi le renouvellement avec six livres connus sur neuf, la diversité et les données invalides.
- **Ouverture et reprise :** cliquer une suggestion importe le vrai fichier et ouvre le lecteur ; revenir depuis Découvrir conserve le mot et les signets sans nouveau téléchargement ni doublon. Les boutons d’export restent actifs. Un EPUB personnel de même œuvre et langue compatible est retrouvé ; une édition anglaise homonyme reste distincte de l’édition française choisie.
- **Contraste Focus :** couleur et graisse 900 des préfixes mesurées dans les trois thèmes ; contraste texte/fond au moins 4,5:1 et contraste entre préfixe et reste du mot au moins 2:1 ; surlignages réels contrôlés sur les préfixes et les suffixes. Largeur de 320 px et police de 32 px vérifiées.
- **Recherche commune :** barre unique fixe à 320 px, identique depuis bibliothèque et Découvrir ; vrais résultats personnels avant les catalogues, déduplication, ouverture sans téléchargement ; EPUB local lisible pendant le chargement et après échec du catalogue. Liens, langue, source, pagination, retour arrière/avant, effacement, saisie et focus pendant une réponse retardée sont vérifiés. Les 32 nouveaux tests unitaires couvrent le classement et la normalisation des routes, dont les anciennes métadonnées et les éditions distinctes.
- **Recherche réelle :** les fichiers du catalogue officiel livré sont interrogés sans simulation d’API ; Hugo, Notre-Dame, Misérables sans accent, recherche anglaise, langue sans requête, pagination et absence de résultat sont vérifiés. Toutes les notices Gutenberg affichent une couverture cliquable ; filtres, 24 résultats par page et pagination sont contrôlés. La suite déterministe simule la réponse du relais pour vérifier l’import, la reprise, les pannes et l’annulation sans dépendre de la disponibilité d’un tiers. Les neuf EPUB intégrés et l’index ne sont pas simulés.
- **Couvertures cohérentes :** Candide conserve palette, titre, auteur et type de couverture entre Découvrir, import, Mes livres et rechargement malgré ses métadonnées internes différentes. Un ancien import sans `source.presentation` retrouve sa couverture ; un EPUB personnel conserve son image originale.
- **Relais et serveur :** 36 tests du relais couvrent les identifiants, méthodes, redirections, signatures EPUB, limites de flux, délais, accès refusés, cache et concurrence. 24 tests HTTP du serveur couvrent MIME, GET/HEAD, santé, fichiers introuvables, traversée de chemins et liens symboliques sortants. Aucun compte ni fichier personnel ne transite par ces endpoints.
- **Début de lecture :** 14 tests contrôlent les notices Gutenberg séparées ou mêlées au texte, les anciens crédits structurés, l’absence de repère fiable et la conservation des titres/préfaces. Les archives originales ne sont pas modifiées.
- **Neuf vrais EPUB :** chacun s’ouvre depuis sa carte, présente le premier mot français revu, donne accès aux commandes et à la licence. Les fichiers EPUB ne sont pas remplacés par des doublures. Le réimport du Horla conserve provenance, date d’ajout et signet.
- **Bibliothèque locale :** import, glisser-déposer, rejet d’un faux EPUB, filtre titre/auteur sans accents, annulation puis confirmation d’une suppression, suppression des repères associés et absence de doublon au réimport.
- **Lecteur :** Classique, Focus et Mot à mot ; vitesse de 100 à 800 mots/min ; pause et reprise ; raccourcis ; pas de dix mots ; chapitres et liens internes ; fin du livre enregistrée à 100 %. Ouvrir les panneaux ou ajouter un signet arrête effectivement le compteur mot à mot.
- **Lisibilité :** mot central et commandes immobiles malgré un contexte très long, mots longs contenus dans leur zone, commandes visibles et absence de débordement horizontal aux formats étroits et paysage. Les couleurs calculées du lecteur et des réglages sont vérifiées en thème clair, en plus de l’état du thème.
- **Repères :** signets sans doublons, retour au passage et suppression ; recherche d’un extrait dans un autre chapitre ; surlignage ; notes créées, annulées pendant une édition, modifiées, supprimées et exportées. Le contenu du Markdown téléchargé est vérifié.
- **Conservation et exports :** reprise après rechargement, police et thème conservés dans IndexedDB, même passage après remise en page et Focus ; EPUB original téléchargé comparé octet par octet ; EPUB Focus réellement ouvert comme archive, avec images, balisage Focus et sans scripts ni image de pistage.
- **Hors connexion :** premier téléchargement d’un livre distant expliqué comme nécessitant le réseau, sans créer un faux livre ; application rechargée après coupure du réseau/serveur, lecture et nouvelles positions sauvegardées ; premier accès au Horla depuis le cache ; recherche française et recherche anglaise après consultation de cette langue en ligne.
- **Défilement et import :** clic sur une autre page, sur la page active ou sur la pagination ramène en haut, sans réinitialiser un passage Classique ni ses signets. Le champ fichier reste permanent pour conserver la sélection pendant les rafraîchissements asynchrones. La navigation interne rend la nouvelle page dès le clic, afin qu’une saisie rapide dans la barre commune ne soit pas ensuite effacée.
- **Navigation :** ancienne adresse du compte redirigée vers les livres locaux, absence de requête d’authentification, livre absent et ancien lien du lecteur expliqués, nom accessible de l’import en affichage compact.
- **Installation :** affichage du bouton seulement après l’événement d’installation, appel de l’invite et traitement de son résultat, avec un événement simulé.

## Téléchargements réels et conteneur

`npm run test:live` a été exécuté avec Chromium à 390 × 844 contre le serveur Node de production local de cette version, sans interception des réponses réseau. Chaque scénario recherche le titre, clique sa couverture, reçoit le vrai EPUB, l’enregistre dans IndexedDB, ajoute un signet, vérifie la couverture après rechargement puis reprend depuis le résultat personnel de la recherche commune sans seconde requête EPUB.

| Édition                               | Taille originale | Premier mot affiché | Parcours complet observé |
| ------------------------------------- | ---------------: | ------------------- | -----------------------: |
| Germinal, Gutenberg 5711              |   504 242 octets | Émile               |                   0,91 s |
| Les misérables Tome I: Fantine, 17489 |   359 981 octets | Les                 |                   0,82 s |
| Pride and Prejudice, 1342             |   558 381 octets | PREFACE.            |                   1,19 s |

Ces durées sont celles de cet essai, pas un engagement de performance. Le CRC ZIP et la présence de la licence ont également été contrôlés séparément sur les vrais fichiers 135, 1342 et 5711 récupérés par le relais ; les miroirs ODU et PGLAF renvoient les mêmes empreintes pour cet échantillon.

Le Dockerfile a été construit avec succès. Le conteneur démarre avec l’utilisateur `node`, sert `/api/health`, l’interface et un EPUB réel en HTTP 200. Cette vérification du conteneur a été faite sur la version précédente du lecteur ; les changements de recherche commune ont ensuite été testés sur le serveur Node local, sans reconstruire le conteneur. Le workflow CI publie désormais le serveur complet en image GHCR ; le webhook de déploiement reste à configurer sur un hébergeur. Aucune image n’a été publiée et aucun site public n’a été déployé pendant ce travail.

## Limites de ces résultats

Les téléphones et tablettes sont **émulés**, pas des appareils physiques. Cette validation ne démontre pas à elle seule le comportement du clavier virtuel, de la sélection par appui long, des barres d’adresse mobiles, des réglages système d’accessibilité ou de l’installation native sur iOS/Android. Les téléchargements publics réels ci-dessous ont été vérifiés sur un échantillon de trois éditions. Cela ne garantit pas que les 77 506 notices restent toutes disponibles : panne du miroir, fichier retiré ou limite de taille peuvent empêcher une ouverture. Les erreurs et le nouvel essai sont prévus dans le parcours.

Les tests ne simulent pas un compte en ligne : le parcours est maintenant local et aucune connexion à un compte, livraison d’e-mail ou base personnelle serveur n’est nécessaire. Le téléchargement des EPUB publics utilise désormais le relais HTTP Node fourni. Aucun push ni déploiement public n’a été effectué dans le cadre de cette validation. Le pipeline est défini dans le dépôt ; son exécution sur GitHub reste distincte des commandes locales.

## Reproduire sur ce poste

Des bibliothèques navigateur manquantes ont été fournies dans un dossier temporaire. La commande locale est :

```sh
LD_LIBRARY_PATH=/tmp/fastreader-browser-libs/root/usr/lib/x86_64-linux-gnu PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 npm run test:e2e -- --workers=3
```

Le pipeline Ubuntu installe normalement ces dépendances avec `npx playwright install --with-deps chromium webkit`. Le scénario WebKit hors ligne coupe un serveur HTTP isolé, car `setOffline` produit une erreur interne de ce moteur avec le service worker dans cet environnement. Ce serveur sert les mêmes fichiers de production, refuse ensuite toute nouvelle connexion et n’a pas de cache HTTP de secours.

La vérification réseau facultative se reproduit avec le serveur déjà lancé :

```sh
LD_LIBRARY_PATH=/tmp/fastreader-browser-libs/root/usr/lib/x86_64-linux-gnu PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 npm run test:live
```

`FASTREADER_URL` permet de viser un autre port, par exemple le conteneur local. Elle reste séparée de la CI pour ne pas rendre chaque build dépendant d’un miroir public.

## 12 septembre 2026 — sources directes et lecture Sépia

- `npm audit --omit=dev --audit-level=high` : aucune vulnérabilité.
- `npm test` : 501 tests, 33 fichiers, tous réussis.
- Suite navigateur : 282 cas exécutés, 266 réussis au premier passage. Les anciennes attentes de thème/mode et de recherche exclusivement locale ont été adaptées. Un véritable contraste insuffisant du lien actif au survol a été corrigé. Les cinq suites concernées ont ensuite passé leurs 87 cas sur Chromium ordinateur/téléphone et WebKit tablette.
- Paramètres des sources : neuf contrôles navigateur, dont états progressifs, fermeture/annulation, cache/nouvelle vérification, focus clavier et audits axe dans les trois thèmes.
- Nouvelles sources : quinze contrôles navigateur avec réponses fidèles contrôlées, téléchargement/import des fichiers EPUB, annulation, erreurs et réponse ELG retardée de trois secondes. La CI ne sollicite pas les serveurs de livres réels.
- Pages avec relais simulé : six contrôles réussis. Build Pages configuré avec l’URL publique : neuf contrôles réussis, téléchargement de test explicitement intercepté. Ces tests ne valent pas preuve d’un téléchargement amont réel.
- Relais public Cloudflare réellement publié et vérifié : statut/search ELG 200, Alice Gutenberg 136 519 octets, Candide ELG 1 530 924 octets, CORS `https://drslid.github.io`. Les fichiers réels ont aussi été parsés et sauvegardés dans IndexedDB lors des essais séparés des adaptateurs.
- Standard Ebooks réellement testé : Pride and Prejudice 831 959 octets, 65 chapitres et 122 675 mots ; Frankenstein 685 797 octets, 38 chapitres et 78 594 mots. Les recherches, couvertures et fichiers ont été obtenus dans un navigateur, sans compte ni API privée.
- Le favicon SVG vert et les trois PNG ont été régénérés ; six pages statiques vérifiées sans JavaScript, Sépia/Verdana.

Le nouveau [rapport page par page](EVOLUTION-SOURCES.md) décrit le résultat et les limites.

Essai navigateur public complet avant publication de l’interface : profil Pixel 7 neuf sur l’origine Pages, seuls les assets de l’application provenant du build local. Les recherches, couvertures et EPUB ont été récupérés sur les vrais serveurs publics. Les trois parcours Lire → Mot à mot/Sépia → IndexedDB → bibliothèque après rechargement → réouverture hors ligne ont réussi, sans erreur JavaScript. Livres : Pride and Prejudice (Standard Ebooks), Candide 637 (ELG), Alice 11 (Gutenberg). Les trois sources étaient disponibles dans les paramètres ; Z-Library était indisponible. La couverture embarquée Standard Ebooks était visible hors ligne.

Contrôle complémentaire : le focus clavier et le défilement horizontal des filtres sont conservés lorsqu’une source répond plus tard. Deux scénarios, exécutés sur les trois profils, vérifient la conservation du contrôle actif et son activation par Entrée. Le démarrage d’une nouvelle recherche et les navigations voulues restent inchangés.
