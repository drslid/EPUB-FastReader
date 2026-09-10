# Rapport des pages et des parcours

État de l’interface révisée le 10 septembre 2026. Les résultats effectivement exécutés et leurs limites sont consignés dans [VALIDATION.md](VALIDATION.md) ; les tableaux ci-dessous décrivent les comportements et leurs scénarios de contrôle.

## Corrections apportées après l’essai

| Problème constaté                                                   | Correction                                                                                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Deux champs de recherche séparés | Barre commune en haut : recherche personnelle et catalogues en parallèle, livres enregistrés prioritaires et éditions dédupliquées |
| Changement de page gardant le défilement précédent | Navigation, page active et pagination ramènent en haut ; la position du lecteur reste indépendante |
| Recherche dépendante d’un service distant indisponible              | Index officiel Gutenberg livré avec le site : recherche réelle dans 4 163 titres français, filtres de langue et pagination ; les sources restent versionnées |
| Résultats Gutenberg limités à une fiche source                      | Tous les résultats retrouvent une couverture cliquable ; un relais récupère l’EPUB public, l’ajoute à la bibliothèque et ouvre le lecteur                    |
| Couverture différente après ajout dans Mes livres                  | Même présentation de catalogue conservée à l’import ; anciens livres rapprochés de la sélection ; couverture des EPUB personnels préservée                  |
| Début des mots insuffisamment distinct en Focus                     | Préfixes de graisse 900 et couleurs différenciées dans les trois thèmes ; contraste du texte et des surlignages contrôlé contre leur fond                    |
| Accueil présentant toujours les mêmes livres                        | Trois suggestions renouvelées au démarrage ou avec « D’autres idées » ; dernière sélection conservée localement                                              |
| Nouvelle ouverture d’un livre déjà présent                          | Correspondance avec la bibliothèque, reprise du passage et des repères sans nouveau téléchargement                                                           |
| Mot central déplacé par le texte du contexte                        | Zone du mot et hauteur du contexte fixes ; présentation compacte en paysage ; mots longs ajustés à la largeur                                                |
| « Mon espace » séparé des livres récemment ouverts                  | Une seule bibliothèque locale, ancien lien redirigé vers cette page                                                                                          |
| Thème clair imposé au retour à l’accueil                            | Thème sombre initial et choix appliqué à toutes les vues, jusqu’aux couleurs effectives des panneaux                                                         |
| Page d’accueil trop encombrée sur téléphone                         | Accès direct aux livres, reprise et recherche ; navigation mobile simplifiée                                                                                 |
| Bouton d’import réduit à une icône sans nom                         | Nom accessible conservé même quand le libellé visuel est masqué                                                                                              |
| Début d’EPUB sur les mentions anglaises du fournisseur              | Point de départ français revu pour les neuf éditions ; préfaces, crédits, licences et fichier original conservés                                             |

## Organisation commune

Le site propose deux destinations principales, **Ma bibliothèque** et **Découvrir**, une page de résultats accessible depuis leur barre de recherche commune, puis un lecteur pour le livre ouvert. Le bandeau de recherche reste attaché en haut pendant le défilement, avec des commandes compactes sur mobile ; le lecteur garde ses propres commandes. La bibliothèque est l’espace personnel : les livres, leur progression, les signets et les notes sont conservés sur cet appareil. L’ancienne adresse `#account` ramène à `#library` ; elle ne présente plus une page vide donnant l’impression que les livres se trouvent ailleurs.

Le thème sombre et le mode mot à mot sont les valeurs initiales. Les choix de thème, mode, police, taille et vitesse sont enregistrés dans IndexedDB avec les livres et leurs repères. Un choix explicite reste appliqué après rechargement et changement de page. La migration conserve les livres déjà présents ; il n’est pas nécessaire de les réimporter.

| Point de cohérence    | Comportement attendu                                                                                    | Couverture automatisée                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Espace personnel      | Tous les livres ouverts/importés se retrouvent dans la bibliothèque ; aucun compte distant              | `account.spec.js`, `library.spec.js`                                  |
| Thème                 | Sombre à la première visite, choix clair/sépia/sombre appliqué aux trois vues                           | `library.spec.js`, `app.spec.js`                                      |
| Mobile                | Navigation courte, lecteur occupant l’écran, commandes accessibles et absence de débordement horizontal | `reader-controls.spec.js`, les trois projets Playwright               |
| Reprise               | Même passage après navigation, rechargement, changement de police et mode                               | `app.spec.js`, `notes.spec.js`, `location.spec.js`, `offline.spec.js` |
| Couvertures            | Même palette, titre, auteur et image avant/après import depuis le catalogue                            | `cover-consistency.spec.js`, `covers.test.js`                           |
| Liens anciens/absents | Retour expliqué vers la bibliothèque                                                                    | `navigation.spec.js`, `account.spec.js`                               |

## Ma bibliothèque — `#library`

**But :** reprendre une lecture, trouver une prochaine histoire ou ouvrir un EPUB personnel. Cette page est également l’accueil. Elle présente trois livres prêts à lire, avec une suggestion principale et deux propositions complémentaires, puis les accès à la bibliothèque et à la dernière lecture.

La sélection est calculée uniquement dans le navigateur. Elle favorise les œuvres absentes de la bibliothèque, puis celles qui attendent leur première lecture ; les livres en cours et terminés restent possibles si nécessaire. Elle diversifie les auteurs et les genres et évite les derniers titres affichés lorsque le choix le permet. Les identifiants de la dernière sélection sont enregistrés dans le magasin IndexedDB `preferences`. Un redémarrage/rechargement ou le bouton **D’autres idées** renouvelle les propositions ; un changement de thème, une recherche ou un aller-retour entre les pages les laisse stables. Les suggestions ne prétendent pas déduire les goûts de l’utilisateur et leur affichage n’importe aucun livre.

| Fonction                  | Résultat à vérifier                                                                                   | Test                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Essayer le lecteur        | Ouverture du texte de démonstration en mot à mot                                                      | `app.spec.js`, `reader-controls.spec.js`          |
| Importer un EPUB          | Import réel, titre/auteur, chapitres dans l’ordre du livre                                            | `app.spec.js`                                     |
| Déposer un fichier        | Même import par glisser-déposer                                                                       | `navigation.spec.js`                              |
| Fichier invalide          | Message compréhensible ; nouvel import toujours disponible                                            | `app.spec.js`                                     |
| Retrouver ses livres      | Une carte par livre ; réimport du même fichier sans doublon                                           | `library.spec.js`                                 |
| Garder la même couverture | Présentation du catalogue conservée après ajout/rechargement ; anciens imports compatibles ; image personnelle préservée | `cover-consistency.spec.js`, `covers.test.js` |
| Retrouver un titre/auteur | Recherche commune, résultats personnels prioritaires, sans accents ; état vide limité à la bibliothèque | `library.spec.js`, `unified-search.spec.js` |
| Reprendre                 | Progression et chapitre conservés après retour/rechargement                                           | `app.spec.js`, `offline.spec.js`                  |
| Supprimer                 | Annulation sans changement ; confirmation supprimant livre et repères associés                        | `library.spec.js`                                 |
| Livre terminé             | Progression enregistrée à 100 %, y compris en mot à mot                                               | `reader-controls.spec.js`                         |
| Changer de thème          | Choix immédiatement visible puis conservé                                                             | `library.spec.js`                                 |
| Suggestions d’accueil     | Trois titres intégrés distincts, rotation au démarrage et sur demande, historique local               | `home-suggestions.spec.js`, `suggestions.test.js` |
| Stabilité des suggestions | Aucun changement inattendu pendant la navigation, la recherche et le choix du thème                   | `home-suggestions.spec.js`                        |
| Ouvrir une suggestion     | Lecture immédiate, ajout réel à la bibliothèque ; reprise depuis Découvrir sans téléchargement répété | `home-suggestions.spec.js`                        |

La correspondance avec un livre présent utilise les identifiants de la source ou, pour un import personnel sans provenance, le même titre et le même auteur normalisés. Cette seconde voie reprend l’édition déjà importée avec ses propres chapitres et repères ; elle ne remplace pas son fichier par l’édition proposée. Elle est testée avec un EPUB d’essai portant le titre et l’auteur du Horla.

Les couvertures utilisent une identité visuelle commune. Un livre téléchargé depuis Découvrir conserve `source.presentation` dans IndexedDB ; l’image interne de l’EPUB et ses éventuelles différences de titre ou d’auteur ne remplacent plus la couverture choisie. Les anciens imports de la sélection sont reconnus sans migration destructive. Les imports personnels gardent leur image de couverture. Les archives originales et leurs métadonnées sont conservées dans tous les cas.

**Limites explicites :** la base appartient au navigateur et à l’origine du site. Changer de navigateur, de domaine ou effacer les données du site ne transfère pas la bibliothèque. Le téléchargement de l’EPUB original et l’export des repères permettent de garder des fichiers ; ils ne constituent pas une sauvegarde/restauration complète automatique de la bibliothèque. Aucun compte ni synchronisation serveur n’est présenté dans le parcours.

## Découvrir — `#discover`

**But :** trouver un livre et commencer à le lire en touchant sa couverture. Ce parcours concerne les neuf éditions intégrées et tous les résultats Gutenberg. Le clic récupère l’EPUB public, l’enregistre dans la bibliothèque et ouvre le lecteur. Une œuvre déjà présente affiche **Dans votre bibliothèque** et **Reprendre** ; l’ouverture conserve sa position et ses repères sans récupérer à nouveau le fichier.

Les résultats apparaissent dans une grille de 24 cartes au maximum. La section **Catalogue externe** a été supprimée. La provenance et les droits restent accessibles par le lien **Source**. Le premier téléchargement d’un titre Gutenberg nécessite une connexion et passe par un relais HTTP qui contacte des miroirs officiels. Il privilégie l’édition texte légère originale ; la lecture et les sauvegardes restent ensuite locales. En cas d’échec, **Réessayer** relance le même livre ; la fiche source et l’import manuel restent des solutions de repli. Quitter la page pendant le téléchargement empêche une ouverture tardive du lecteur.

La recherche publique ne dépend plus de l’API publique Gutendex. La provenance, la version et le processus de mise à jour des données sont détaillés dans [SOURCES.md](SOURCES.md).

| Fonction                       | Résultat à vérifier                                                                                                                      | Test                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Sélection prête à lire         | Les neuf vrais EPUB sont servis par le site et lisibles en un clic                                                                       | `discovery.spec.js`        |
| Recherche titre/auteur         | Résultats issus du catalogue livré, sans serveur de recherche tiers                                                                      | `discovery.spec.js`        |
| Accents, langues, pagination   | Résultats reproductibles et navigation entre les pages                                                                                   | `discovery.spec.js`        |
| Aucune correspondance          | État vide explicite, recherche suivante possible                                                                                         | `discovery.spec.js`        |
| Source ou fichier indisponible | Explication, nouvelle tentative ou retour à la sélection                                                                                 | `discovery.spec.js`        |
| Couverture Gutenberg           | Téléchargement automatique, lecteur ouvert et livre enregistré ; reprise sans seconde récupération                                      | `discovery.spec.js`        |
| Relais indisponible            | Aucun livre fantôme ajouté ; nouvelle tentative sur la même couverture puis ouverture                                                    | `discovery.spec.js`        |
| Changement de page             | Téléchargement annulé côté navigateur, sans ajout ni navigation tardive                                                                   | `discovery.spec.js`        |
| Reprendre un livre présent     | Même livre local, même passage et mêmes signets ; aucun nouveau téléchargement                                                           | `home-suggestions.spec.js` |
| Droits et provenance           | Liens visibles près des livres et dans les réglages du lecteur                                                                           | `discovery.spec.js`        |
| Hors connexion                 | Livres enregistrés et sélection installée restent accessibles                                                                            | `offline.spec.js`          |

**Limites explicites :** un index livré est un instantané, pas un service en temps réel. Les titres ajoutés plus récemment sur la source apparaîtront après la prochaine mise à jour de l’index. Un EPUB peut manquer sur les miroirs ou être momentanément indisponible ; le parcours explique l’échec. La version complète doit être hébergée avec son relais HTTP, car un site statique seul ne fournit pas cette route. Le statut du domaine public annoncé par une source ne vaut pas automatiquement pour tous les pays. Les réponses Gutenberg des tests navigateur sont contrôlées ; les essais sur les sources réelles sont distingués dans [VALIDATION.md](VALIDATION.md).

## Recherche commune — `#search?q=…&language=fr&provider=all&page=1`

**But :** trouver un livre sans décider d’abord où chercher. La même barre est disponible dans la bibliothèque, Découvrir et les résultats. La saisie est validée avec Entrée ou le bouton Rechercher ; chaque nouvelle recherche interroge toutes les sources. Les titres/auteurs internes et ceux de la couverture enregistrée sont recherchés sans distinction de casse ou d’accents.

**Mes livres** s’affiche d’abord, avec couverture compacte, progression et accès à la copie enregistrée. Les catalogues se chargent indépendamment ; une source lente ou indisponible ne bloque pas la lecture locale. Les éditions reconnues comme déjà possédées sont retirées de la page publique et leur exemplaire local reste proposé, même si le titre interne de son ancien EPUB diffère. Le nombre de références publiques reste celui du catalogue ; les copies personnelles ne sont pas soustraites artificiellement de ce total.

La langue et les boutons de source filtrent uniquement les catalogues. Cliquer une source applique aussi le titre et la langue saisis, puis revient à la première page. La pagination conserve les critères de la recherche validée. **Effacer la recherche** relance une recherche vide dans toutes les sources, conserve la langue choisie et montre tous les livres enregistrés. Revenir à Ma bibliothèque ou Découvrir ouvre leur vue complète ; Retour/Avance du navigateur restaure les critères encodés dans le lien.

| Fonction | Résultat à vérifier | Test |
| --- | --- | --- |
| Champ unique et fixe | Accessible après défilement à 320 px et sur les deux pages | `unified-search.spec.js` |
| Résultats personnels d’abord | Copie locale, progression, aucune seconde récupération | `unified-search.spec.js`, `search-results.test.js` |
| Catalogues lents ou en panne | Livre personnel visible et lisible pendant/après l’échec | `unified-search.spec.js` |
| Déduplication des éditions | Identité de source, langue compatible, ancien titre et alias ; autres éditions conservées | `search-results.test.js` |
| Liens et historique | Requête, langue, source et page restaurées au rechargement et Retour/Avance | `unified-search.spec.js`, `search-route.test.js` |
| Défilement | Haut de page pour navigation, page active et pagination ; marque-page Classique préservé | `unified-search.spec.js` |
| Saisie en cours | Brouillon et focus conservés quand le catalogue termine ; source applique la langue choisie | `unified-search.spec.js` |

L’entrée du sélecteur de fichier reste permanente, hors de la vue remplacée : l’arrivée des résultats ne peut plus supprimer un import choisi en parallèle. Les parcours d’import au démarrage et pendant le chargement sont vérifiés dans les suites bibliothèque et recherche commune.

## Lecteur — `#read=…`

**But :** lire, changer de mode et retrouver sa place sans chercher les commandes.

| Fonction                 | Résultat à vérifier                                                                                                                         | Test                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Mot à mot par défaut     | Un mot central, démarrage volontaire, contexte secondaire                                                                                   | `app.spec.js`, `reader-controls.spec.js`                                |
| Mot et commandes stables | Le contexte long ne déplace pas la zone centrale ni le bouton de lecture                                                                    | `reader-controls.spec.js` aux formats 375 × 740, 320 × 640 et 812 × 375 |
| Mots longs               | Mot visible dans sa zone sans débordement horizontal                                                                                        | `reader-controls.spec.js`                                               |
| Lecture/pause            | Compteur qui avance puis s’arrête ; reprise au bon mot                                                                                      | `app.spec.js`, `reader-controls.spec.js`                                |
| Cadence                  | Commandes rapides, réglage précis et bornes de 100 à 800 mots/min                                                                           | `reader-controls.spec.js`, `app.spec.js`                                |
| Revenir/avancer          | Pas de dix mots ; impossibilité de revenir avant le début                                                                                   | `reader-controls.spec.js`                                               |
| Classique et Focus       | Texte complet ou début des mots accentué, même position de lecture                                                                          | `app.spec.js`, `notes.spec.js`, `location.spec.js`                      |
| Contraste Focus          | Préfixe en graisse 900 ; contraste ≥ 4,5:1 avec le fond et ≥ 2:1 entre les deux parties du mot ; surlignages lisibles dans les trois thèmes | `focus-contrast.spec.js`                                                |
| Revoir le passage        | Retour au texte depuis le mot courant                                                                                                       | `notes.spec.js`                                                         |
| Taille et police         | Choix appliqué, conservé ; passage stable après remise en page                                                                              | `app.spec.js`, `reader-controls.spec.js`, `location.spec.js`            |
| Chapitres                | Précédent/suivant, sélection directe, liens internes EPUB                                                                                   | `app.spec.js`, `reader-controls.spec.js`                                |
| Fin de chapitre/livre    | Pause en fin de chapitre ; livre à 100 % après « Terminer »                                                                                 | `reader-controls.spec.js`                                               |
| Raccourcis               | Espace, flèches, Échap ; saisie des champs préservée                                                                                        | `navigation.spec.js`, `reader-controls.spec.js`                         |
| Repère automatique       | Passage sauvegardé, reprise après fermeture/rechargement                                                                                    | `notes.spec.js`, `offline.spec.js`                                      |
| Signets                  | Ajout, doublon évité, retour au passage, suppression                                                                                        | `notes.spec.js`                                                         |
| Recherche dans le livre  | Extrait cliquable d’un autre chapitre, recherche sans accents, absence de résultat                                                          | `notes.spec.js`                                                         |
| Surligner                | Passage marqué sans imposer une note ; marque conservée en Focus                                                                            | `notes.spec.js`, `location.spec.js`                                     |
| Notes                    | Création, édition, retour au passage et suppression persistante                                                                             | `notes.spec.js`                                                         |
| Export des repères       | Fichier Markdown contenant réellement la citation et la note                                                                                | `notes.spec.js`                                                         |
| Export original          | Fichier téléchargé strictement identique à l’EPUB importé                                                                                   | `library.spec.js`                                                       |
| Export Focus             | Archive EPUB valide conservant ses images et son contenu nettoyé                                                                            | `app.spec.js`                                                           |
| Contenu EPUB             | Scripts et images distantes neutralisés ; liens internes utilisables                                                                        | `app.spec.js` et tests unitaires EPUB                                   |

L’ouverture des réglages, des repères ou l’ajout d’un signet met la lecture mot à mot en pause. Le lecteur reprend uniquement après une action volontaire. Cette interruption est vérifiée en observant que le compteur cesse d’avancer.

Le compteur d’écran et la progression décrivent l’affichage actuel, pas la pagination d’une édition imprimée. Le marque-page suit le texte afin de résister aux différences entre téléphone et ordinateur. Les choix de présentation ne constituent pas une promesse d’amélioration mesurable de la vitesse ou de la compréhension ; voir [READING-UX.md](READING-UX.md).

Les tests Focus calculent le contraste à partir des couleurs effectives du navigateur pour le texte ordinaire, les préfixes et les passages surlignés, dans les thèmes sombre, clair et sépia. Ils vérifient aussi les commandes et l’absence de débordement à 320 pixels, avec une taille de texte portée à 32 pixels. Ces contrôles ciblés ne constituent pas un audit complet d’accessibilité du site.

## Sources et droits — `books/NOTICE.html`

Cette page secondaire présente la provenance des neuf éditions, leurs téléchargements originaux et la licence complète. Un lien ramène au catalogue. Le test `discovery.spec.js` ouvre réellement cette page sur les trois profils, vérifie les neuf fichiers proposés, lit la présence de la licence, télécharge l’original du Horla et revient dans l’application. L’absence de débordement horizontal est également vérifiée. Cette notice statique conserve sa présentation sombre ; le choix de thème du lecteur concerne les vues applicatives.

## Installation et hors connexion

Le service worker est testé avec la production compilée, puis une coupure effective du réseau/serveur. Ces tests vérifient le rechargement de l’application, la lecture et la conservation de nouvelles positions sans connexion. Le bouton d’installation est testé avec l’événement fourni par le navigateur simulé : affichage, appel de l’invite et retrait du bouton. Cela ne vérifie pas l’interface native d’installation d’Android, iOS, Windows ou macOS.

Le serveur de production sert les fichiers compilés et les téléchargements publics. `server-app.test.js` ouvre un vrai port HTTP local pour vérifier les types de fichiers, HEAD, le cache, la route de santé et le rejet des accès hors du dossier public, y compris par lien symbolique. Les tests du relais couvrent les réponses sources et leurs erreurs. Aucune base de données personnelle n’est introduite sur le serveur ; voir [STORAGE.md](STORAGE.md).

## Ce qui demande encore du matériel réel

Les profils PC, téléphone et tablette sont des **émulations Playwright** (Chromium et WebKit). Les tailles étroites et paysage sont mesurées dans ces moteurs. Une vérification sur un vrai iPhone et un vrai Android reste distincte : barre d’adresse rétractable, clavier virtuel, encoche, sélection tactile prolongée, taille de texte système, lecteur d’écran et installation native. Les sélections de texte des tests sont des sélections DOM réelles déclenchées par le scénario, pas une reproduction physique d’un appui long.

Les fonctions présentes sont rattachées à un test ci-dessus. La couverture est une vérification des parcours et de leurs sorties, pas une garantie mathématique contre toute erreur ni un pourcentage de couverture de code.

Les idées pour la prochaine version, distinctes des fonctionnalités livrées ici, figurent dans [AMELIORATIONS.md](AMELIORATIONS.md).
