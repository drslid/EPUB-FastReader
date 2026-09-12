# Évolution du lecteur et des parcours

Ce rapport décrit les changements préparés après validation des sept premiers chantiers : confort Mot à mot, sauvegarde complète, réglages avec aperçu, navigation et accessibilité, prise en main, PWA et import EPUB. Il distingue les fonctionnalités présentes dans le code des intégrations qui restent à décider. Le statut du déploiement public est indépendant de ces changements locaux.

## Accueil

L’adresse d’entrée et `#home` ouvrent une page dédiée à la découverte. Elle contient **Essayer le lecteur**, l’import EPUB et trois suggestions renouvelables avec **D’autres idées**. Les suggestions conservent leur sélection pendant la navigation et les changements de thème ; le démarrage suivant renouvelle les choix lorsque le catalogue le permet.

Les explications des modes **Mot à mot**, **Classique** et **Focus** sont regroupées dans une aide facultative. Elles ne retardent pas l’affichage des suggestions sur téléphone. Un encart permet de reprendre le livre en cours lorsqu’il existe.

La démonstration reste accessible depuis l’accueil. Elle ne figure plus parmi les livres de la bibliothèque ni dans les résultats personnels de la recherche. Les éventuels repères déjà conservés pour cette démonstration ne sont pas effacés.

## Ma bibliothèque

`#library` affiche uniquement les EPUB importés ou obtenus depuis les sources. Les suggestions se trouvent sur l’accueil ; consulter une couverture dans les résultats n’enregistre pas un livre. L’ajout intervient après import réussi.

Chaque carte présente son titre, son auteur, sa progression et la suppression. Le menu **Télécharger l’EPUB** propose deux exports :

- **Classique** : une version nettoyée sans mise en évidence Focus ;
- **Focus** : une version utilisant l’intensité Focus et le traitement des mots courts choisis dans les réglages.

Le téléchargement de l’archive **originale**, inchangée, reste disponible dans le lecteur. Il est distinct de l’export Classique reconstruit. Les exports nécessitent l’original EPUB conservé dans la base ; les anciennes entrées qui ne le possèdent pas doivent être réimportées.

Les couvertures issues des catalogues conservent leur identité entre l’accueil, les résultats et la bibliothèque. Les EPUB personnels gardent leur image d’origine. Les couvertures typographiques affichent le titre et l’auteur en entier : retour à la ligne, taille adaptée et croissance de la couverture si nécessaire. L’auteur occupe le bas de la couverture ; la signature décorative « f. » a été retirée.

## Découvrir et recherche commune

La barre fixe cherche par titre ou auteur dans la bibliothèque et les catalogues. Les résultats personnels restent en premier ; une édition enregistrée ne réapparaît pas inutilement dans les résultats distants. Les filtres de langue et de source concernent les catalogues. Le retour arrière conserve les paramètres de recherche.

Les cartes proposent **Obtenir l’EPUB** et **Lire** : le premier télécharge le fichier sans l’ajouter à la bibliothèque ; le second l’importe et ouvre le lecteur quand la source est accessible. Un livre déjà présent se reprend depuis sa position locale. Les mentions répétitives « Lecture en un clic » et « EPUB à télécharger puis importer » ont été retirées des cartes. Les descriptions sont plus discrètes et les titres restent complets.

**Limite actuelle sur GitHub Pages :** les neuf livres intégrés s’ouvrent directement. Pour les autres EPUB Gutenberg, aucun relais distant n’est activé dans cette configuration. Le bouton **Lire** ne contourne pas les restrictions du navigateur : une explication permet de télécharger sur Gutenberg puis d’importer le fichier. La version Node/Docker dispose du relais nécessaire à l’ouverture automatique. Aucun appel à une API inexistante n’est effectué par le build Pages sans relais configuré.

Aucune nouvelle source n’a été ajoutée. Toute source autre que Gutenberg sera comparée et validée ensemble avant intégration : catalogue français, couverture et titre complets, provenance, droits de l’édition et ouverture réelle de l’EPUB depuis l’hébergement choisi.

## Lecteur

### Mot à mot

Le lecteur propose une cadence **Souple** ou **Régulière**, de 100 à 800 mots/minute. La cadence Souple prolonge l’affichage des mots longs et des ponctuations ; il ne s’agit pas d’une mesure de compréhension. **Phrase précédente** complète le retour et l’avance de dix mots.

L’option **Garder l’écran allumé** demande un verrou d’écran pendant la lecture active. Il est relâché à la pause et lorsque la page n’est plus visible. Un refus, une API absente ou une décision du système n’empêche pas la lecture. Son fonctionnement dépend du navigateur et du téléphone ; l’option n’est pas une garantie de maintien de l’écran dans toutes les circonstances.

### Réglages et aperçu

Trois profils offrent un point de départ : **Équilibré**, **Confort** et **Focus léger**. L’aperçu réagit immédiatement aux réglages, qui restent enregistrés dans IndexedDB. Le passage de lecture est conservé après une modification de la mise en page.

Les réglages avancés incluent l’interligne, la largeur maximale du texte, une intensité Focus de 20 à 70 % et l’exclusion des mots de une à trois lettres. Ils complètent la taille, les trois familles de polices système et les thèmes sombre, clair et sépia. Aucune police supplémentaire n’est téléchargée et aucun bénéfice médical n’est promis. Une réinitialisation permet de retrouver les réglages de confort initiaux.

### Navigation et accessibilité

Le sommaire dispose d’un accès direct, avec fermeture explicite et retour du focus à la commande d’ouverture. Les panneaux de réglages et de repères gèrent le focus clavier et empêchent d’interagir avec le contenu masqué derrière eux. Les raccourcis restent documentés : Espace, flèches gauche/droite et Échap.

Au premier usage, la préférence système de réduction des mouvements peut sélectionner Classique. Un choix explicite de mode enregistré ensuite reste prioritaire. Le mode Mot à mot ne démarre jamais automatiquement. Les transitions CSS respectent également cette préférence.

Les vérifications automatisées de contraste, de clavier et de taille d’écran complètent ces comportements. Une validation réelle avec VoiceOver/TalkBack, le clavier virtuel et plusieurs appareils physiques reste nécessaire avant de conclure à une couverture complète de l’accessibilité.

## Sauvegarde

Le panneau **Sauvegarde** est accessible depuis le haut de la bibliothèque et la barre latérale sur ordinateur. Il exporte un ZIP contenant les EPUB originaux, les positions, les signets, les notes et les préférences conservées. Le lecteur peut transférer ce fichier vers un autre appareil et le restaurer sans compte.

La restauration vérifie l’archive et prépare les livres avant l’écriture. Elle ajoute les livres absents et fusionne les nouveaux repères sans écraser les livres, positions et notes déjà présents. Le remplacement des réglages nécessite de cocher l’option correspondante. Une archive invalide est rejetée et une erreur d’écriture ne doit pas laisser une restauration partielle.

Les limites actuelles sont **500 livres et 250 Mio par sauvegarde**, avec des limites supplémentaires pour les entrées et les contenus décompressés. Une bibliothèque de moins de 500 livres peut donc dépasser la limite de taille. La restauration limite également le contenu préparé à 300 Mio. Les limites sont affichées en « Mo » dans l’interface.

Le panneau affiche l’estimation de stockage fournie par le navigateur, lorsqu’elle existe, et permet de demander une protection contre l’éviction automatique. Le navigateur décide de l’accorder. Cette protection ne remplace pas un ZIP conservé en dehors du navigateur : effacer les données du site supprime la bibliothèque locale.

## PWA et hors connexion

Un bandeau signale une nouvelle version disponible. **Mettre à jour** commence par sauvegarder la lecture avant de demander l’activation du nouveau service worker et le rechargement. Si la sauvegarde échoue, la mise à jour attend. Le lecteur peut aussi reporter l’action. Une aide d’installation pour iPhone/iPad, Android et ordinateur reste accessible lorsque l’invitation native n’est pas disponible.

Le cache doit être installé pendant une première visite connectée. Les livres importés, les neuf éditions intégrées et la recherche française sont ensuite disponibles hors ligne ; les autres langues sont conservées après consultation. Un résultat distant non téléchargé n’est pas rendu disponible hors ligne par sa seule présence dans le catalogue.

## Import et compatibilité EPUB

La lecture et la décompression ZIP passent par un **Web Worker**, avec une solution de repli lorsque ce mécanisme est indisponible. Une progression par chapitre informe sur l’avancement, et le traitement rend régulièrement la main au navigateur.

Le DOM, le nettoyage HTML et une partie du traitement des chapitres restent exécutés sur le fil principal. Tous les chapitres sont encore préparés pendant l’import : il ne s’agit pas d’un chargement des chapitres uniquement au moment de les lire. Une très grande page peut donc encore produire un blocage ponctuel ; aucun engagement de 60 images/seconde n’est donné.

Les tests de compatibilité couvrent notamment l’ordre de lecture, les titres du sommaire, les liens internes, les notes de bas de page, les tableaux, les images et le rejet des contenus actifs. Les EPUB restent limités à 30 Mio, avec des protections sur l’archive décompressée. Les livres protégés par DRM ne sont pas acceptés. Mise en page fixe, SVG, MathML, audio et vidéo ne bénéficient pas d’une prise en charge complète.

## Lecture vocale : deux pistes à écouter

Aucun moteur audio n’a été intégré dans cette version. Deux solutions libres peuvent être exécutées localement, sans abonnement de synthèse vocale, mais leur adaptation au navigateur et leurs performances sur téléphone restent à évaluer.

- **Kokoro** : piste à prototyper avec la voix française `ff_siwis`. Le catalogue officiel ne propose qu’une voix française et signale une couverture des langues autres que l’anglais parfois limitée. Le naturel doit être jugé à l’écoute d’extraits français représentatifs, sans déduire le résultat des démonstrations anglaises. [Voix officielles de Kokoro](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md)
- **Piper** : moteur neuronal local proposant des voix à comparer. Le code actuel est distribué sous GPL-3.0 ; il faudra vérifier séparément les licences des voix retenues et les conditions de leur distribution dans le projet. [Dépôt officiel Piper](https://github.com/OHF-Voice/piper1-gpl)

Le téléchargement initial des modèles, la mémoire, la batterie et la latence doivent être mesurés avant de promettre une lecture vocale naturelle et hors ligne sur mobile. La prochaine étape utile est une écoute comparative courte, puis un essai technique sur les appareils visés.

## Validation exécutée

| Vérification | Résultat final local |
| --- | --- |
| Tests unitaires | **361 réussis**, 21 fichiers : EPUB, stockage, restauration atomique, réglages, cadence, Wake Lock, mise à jour PWA, catalogue et relais |
| Parcours navigateur | **237 scénarios distincts validés**, répartis entre Chromium ordinateur, Chromium téléphone et WebKit tablette, avec contrôles ciblés rejoués après les corrections. Aucun scénario ignoré. |
| GitHub Pages sans relais | **8 contrôles réussis** sous `/EPUB-FastReader/`, dont rechargement hors ligne, import, reprise et absence d’API locale |
| GitHub Pages avec relais configuré simulé | **6 contrôles réussis dans chacun des deux moteurs Chromium et WebKit** : compilation dédiée, lecture, conservation exacte de l’EPUB, reprise, refus403 et hors-ligne |
| Accessibilité | axe-core sur accueil, bibliothèque, découverte, trois modes, réglages et aide d’installation ; clavier, réduction des mouvements et contrastes Focus vérifiés |
| Mise en page | Titres/auteurs longs complets, absence de débordement à 320px, stabilité du mot et des commandes en portrait et paysage812×375 |

La validation locale est effectuée avant publication ; le pipeline GitHub Actions réexécute les tests avant de déployer Pages. Les campagnes successives ne sont pas additionnées dans le total des scénarios.

Les profils téléphone et tablette sont des **émulations de navigateur**, pas des essais sur appareils physiques. Les tests de Wake Lock et de mise à jour PWA utilisent aussi des événements contrôlés ; ils ne garantissent pas à eux seuls toutes les décisions d’économie d’énergie ou d’installation des systèmes mobiles.
