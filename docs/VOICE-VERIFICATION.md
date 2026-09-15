# Vérifications de la lecture vocale locale

> **Archive — ancien moteur Kokoro.** Ces essais décrivent l’implémentation précédente, avant le passage à Piper Medium. Les noms de voix, tailles, politiques mobiles et mesures ci-dessous ne décrivent pas le moteur actuel. Voir [les vérifications Piper](PIPER-VERIFICATION.md) et [le guide de la lecture vocale](LOCAL-VOICE.md).

Essais vocaux : 14 septembre 2026. Contrôle avant publication : 15 septembre 2026.

Ce rapport porte sur le moteur réellement intégré dans
[`src/voice-engine.js`](../src/voice-engine.js) et
[`src/voice-worker.js`](../src/voice-worker.js). Les mesures du prototype Kokoro
préalable ne sont pas utilisées pour valider cette intégration.

## Génération avec le modèle réel

Les essais ont utilisé les moteurs de navigateur **de bureau** de Playwright
1.63.0 dans le conteneur du projet. Le worker exécutait Kokoro q8 sur WASM, avec
un seul thread, à vitesse 1. Le modèle, le tokenizer et les voix provenaient du
cache local `fastreader-voice-v1`, prérempli avant le premier démarrage du
worker. Aucune API de synthèse vocale n’était utilisée.

| Navigateur | Voix | Durée du son produit | Calcul, avec initialisation si nécessaire |
| --- | --- | ---: | ---: |
| Chromium | Français — Siwis | 2,700 s | 5,130 s |
| Chromium | Anglais — Heart | 2,575 s | 3,718 s |
| Chromium | Espagnol — Dora | 2,400 s | 3,519 s |
| Chromium | Italien — Sara | 3,125 s | 4,493 s |
| Chromium | Portugais brésilien — Dora | 2,275 s | 3,233 s |
| Firefox | Français — Siwis | 2,700 s | 5,099 s |
| WebKit | Français — Siwis | 2,700 s | 7,261 s |

Ces essais courts vérifient que les cinq voix fonctionnent. Ils ne constituent
pas un comparatif représentatif des performances. La première génération
française comprend le chargement initial du modèle ; les changements de voix
suivants dans Chromium réutilisent ce modèle. Les durées mesurées montrent
qu’une attente entre passages reste possible.

Les textes synthétisés étaient les suivants :

- Français : « Bonjour. Cette voix lit votre livre. »
- Anglais : « Hello. This voice reads your book. »
- Espagnol : « Buenos días. Esta voz lee un libro. »
- Italien : « Buongiorno. Questa voce legge un libro. »
- Portugais : « Bom dia. Esta voz lê um livro. »

Les WAV ont été contrôlés : durée positive, échantillons finis, signal non
silencieux. Un contrôle séparé des cinq phonémisations a confirmé que les
symboles produits pour les extraits vérifiés figurent dans le vocabulaire du
modèle. **Ces contrôles ne remplacent pas une écoute humaine : le naturel de la
voix et l’exactitude de la prononciation n’ont pas été évalués à l’oreille.**

## Fonctionnement sans réseau

Les trois moteurs ont également réussi les vérifications suivantes :

- Aucun téléchargement vocal à la création du moteur ou à l’ouverture de la
  page de vérification.
- Aucun appel externe et aucun envoi du texte pendant la synthèse.
- Rejet d’une voix inconnue.
- Rejet d’un texte dépassant la limite du moteur, sans troncature silencieuse.
- Annulation pendant une génération, puis recréation du worker et rechargement
  du modèle sans connexion.

Sur Chromium et Firefox, le mode `context.setOffline(true)` de Playwright était
activé **avant la première synthèse**.

Sur WebKit, cette commande provoquait une erreur interne de l’outil dès la
requête du worker pourtant présent dans le cache. Le test a donc été refait en
**arrêtant réellement le serveur HTTP avant la première synthèse**, sans
modifier l’émulation réseau du navigateur. La génération française et le
redémarrage ultérieur du worker ont alors réussi. Aucun contournement par
worker Blob n’a été ajouté à l’application.

Ces résultats concernent la génération à partir de fichiers déjà installés.
Ils ne signifient pas qu’une première installation peut se faire sans réseau :
l’application, le livre et la voix doivent être conservés sur l’appareil avant
une écoute entièrement hors ligne.

## Tests de l’application et affichage

Les résultats confirmés au moment de ce rapport sont :

- La validation initiale de la préparation anticipée comptait **911 tests
  unitaires réussis** et **405 scénarios navigateur validés**, sur les
  configurations bureau Chromium, téléphone Chromium et tablette WebKit.
  Les contrôles des corrections suivantes sont détaillés plus bas.
- Vérification du build Pages avec relais simulé : six contrôles réussis,
  dont ouverture d’EPUB et reprise hors ligne après arrêt du serveur.
- **36 configurations visuelles vérifiées** : six langues, trois thèmes et
  deux formats d’écran.

Les tests déterministes du téléchargement couvrent le choix explicite de la
voix, la progression, l’annulation, la reprise, les erreurs de réseau,
l’intégrité des fichiers, le quota, le retrait d’une voix et le fonctionnement
avec des fichiers déjà installés. Les tests du lecteur couvrent également les
transitions de mode, les positions et les commandes d’écoute. Ils complètent
les essais de génération avec le modèle réel présentés ci-dessus ; ils ne
mesurent pas la qualité sonore.

Un essai supplémentaire a parcouru le **lecteur complet avec le modèle réel**
sur Chromium, dans une fenêtre de 320 × 640 pixels. Après installation des
fichiers réels par HTTP local, le réseau a été coupé avant de choisir la voix.
Le bouton « Lancer l’écoute » a préparé puis joué le son, surligné « Camille a
ouvert son livre près de la fenêtre. », et Pause a arrêté la lecture. Le son
mesurait 3 secondes ; le premier passage de prose a commencé après environ
9,3 secondes, lecture du titre comprise. Aucun appel externe ni erreur
JavaScript n’a été observé. Les résultats de cet essai figurent dans
`.cache/voice-ui-visual/real-result.json`. Il valide le parcours avec une vraie
synthèse, sans constituer une mesure sur téléphone physique.

Les vérifications techniques du moteur et du cache se trouvent notamment dans :

- [`voice-engine.test.js`](../tests/voice-engine.test.js) : démarrage différé,
  résolution de l’URL de base, résultats WAV, annulation, erreurs et libération
  du worker.
- [`voice-service-worker.test.js`](../tests/voice-service-worker.test.js) :
  cache vocal séparé, absence de téléchargement implicite du modèle,
  remplacement d’un runtime périmé et conservation des voix pendant une mise à
  jour de l’application.
- [`voice-downloads.test.js`](../tests/voice-downloads.test.js) : installation
  explicite, erreurs, reprise et gestion des fichiers partagés.
- [`server-app.test.js`](../tests/server-app.test.js) : types MIME `.mjs` et
  `.wasm` corrects avec GET et HEAD, en conservant `nosniff`.

## Build, PWA et distribution

Les builds standard et GitHub Pages ont réussi. Les listes de précache et de
chargement différé de l’application ne contiennent **aucun fichier
`voice-runtime/`** : publier le runtime ne déclenche pas son téléchargement à
l’ouverture de FastReader. Le cache vocal survit aux mises à jour de
l’application et ses clés incluent le chemin de base du déploiement.

Le premier téléchargement français représente environ **116,5 Mo**, affiché
arrondi dans l’interface. Le modèle et le pack de prononciation commun sont
réutilisés pour les autres voix concernées. Les tailles et empreintes SHA-256
sont vérifiées avant de considérer un fichier comme installé.

Transformers.js 3.8.1 et ephone 1.0.2 sont figés. Le build distribue également
l’archive vérifiée des sources correspondantes d’ephone/eSpeak NG, séparément
du téléchargement vocal et du précache PWA. Voir les
[licences et sources des composants vocaux](THIRD-PARTY-VOICE.md).

L’audit npm effectué a retourné **zéro vulnérabilité**, dépendances de
développement comprises. Le navigateur utilise la distribution Transformers
inchangée ; sa dépendance de développement indirecte `sharp` est fixée à la
version corrigée 0.35.4.

## Préparation anticipée et file locale

La préparation d’un livre conserve chaque passage terminé dans une base
IndexedDB distincte (`fastreader-audio`). Les octets audio sont enregistrés en
ArrayBuffer puis restitués en Blob pour la lecture : cela évite l’erreur WebKit
« Error preparing Blob/File data to be stored in object store » rencontrée avec
le stockage direct des Blob. L’audio et la progression sont validés dans la
même transaction.

Un verrou Web Locks commun à la file et à la synthèse immédiate empêche deux
sessions de conversion indépendantes, y compris entre onglets. Une session
peut désormais utiliser deux Workers selon la capacité de l’appareil.
L’écoute immédiate suspend la
file locale ; écouter un audio déjà préparé ne lance aucun moteur. Les tests
couvrent notamment la sérialisation, la reprise après fermeture, l’annulation,
le quota, les réponses tardives, les changements de texte, les passages longs
et la lecture préparée sans génération.

Un essai avec le **modèle réel**, sur Chromium 153 de bureau dans une fenêtre
320 × 640, a converti un EPUB court en trois passages : **9,87 secondes** de
préparation, progression **100 %**, **265 332 octets** pour **5,525 secondes**
d’audio. Le format ArrayBuffer a été vérifié directement en base. Après
suppression complète du cache vocal et coupure réseau, le bouton d’écoute a
lancé le son natif en environ **204 ms**, sans nouveau worker. Le surlignage du
passage, l’avance et la pause ont fonctionné ; aucun appel externe ni erreur
JavaScript n’a été observé. Ces mesures sur un petit extrait ne prédisent pas
la durée de préparation d’un livre entier sur téléphone.

Les artefacts de cet essai sont conservés dans `.cache/audio-queue-real/`.
L’affichage du choix et de la file a aussi été contrôlé à 320 × 640 et 640 × 320,
en français et allemand, sur Chromium et WebKit ; les contrôles axe ciblés
n’ont relevé aucune violation. La documentation utilisateur décrit la mise en
pause en arrière-plan, la reprise explicite après fermeture et l’espace
supplémentaire requis par les fichiers audio, exclus des sauvegardes EPUB.

## Écoute pendant la préparation

La file publie maintenant un préfixe contigu de passages prêts. Le lecteur
écoute ces passages depuis IndexedDB pendant que le même worker prépare la
suite. Arrivé à la frontière, il attend au lieu de terminer le chapitre.
L’arrivée du passage suivant reprend l’écoute, sauf après une pause explicite.
Un signet situé plus loin attend son passage ; un changement de livre ou une
annulation invalide les lectures en cours.

Un nouvel essai avec **Kokoro q8 et Siwis réels**, Audio natif et fenêtre
Chromium de **320 × 640**, a commencé l’écoute à **1 passage sur 4 préparé**.
Le panneau a été quitté vers la bibliothèque sans arrêter le worker, puis le
réseau a été coupé. Après les **1,625 secondes** du premier passage, le lecteur
a attendu **11,214 secondes** avant de reprendre automatiquement sur un
passage de prose de **8,825 secondes**. La conversion restait active à 2/4
passages : **un seul worker** était présent pendant l’écoute. L’annulation
depuis la file a supprimé le travail, terminé le worker et arrêté le son.
Aucune erreur JavaScript ni requête externe n’a été observée. Les mesures et
captures figurent dans `.cache/audio-queue-real/partial-result.json` et
`PARTIAL-VERIFICATION.md`. Ces délais décrivent cet extrait sur cette machine,
pas les performances d’un téléphone physique.

Les tests couvrent aussi l’ajout d’un deuxième livre depuis la bibliothèque,
l’annulation séparée des préparations, l’attente au changement de chapitre,
la reprise automatique, la pause pendant l’attente et l’absence de redémarrage
après avoir quitté le lecteur. Les libellés de la file et de ces états sont
traduits dans les six langues de l’interface.

Sur un écran paysage de 640 × 320, le texte et les commandes audio disposent
de zones de défilement séparées. Les tests vérifient leur absence de
chevauchement, les cibles tactiles de 44 px, le retour du focus après fermeture
de la file et la rotation vers 320 × 640 pendant l’attente. Les captures
finales et les contrôles axe n’ont relevé ni débordement ni violation sur ces
éléments ; l’affichage des autres modes conserve sa disposition habituelle.

## Retour à la préparation et phrases complètes

Un clic sur « Écouter » retrouve maintenant la préparation du livre courant,
y compris après rechargement et pendant l'extraction de ses chapitres. Il ouvre
la file et son avancement sans reproposer le lancement ni créer un doublon.
La préparation avec une autre voix reste une action explicite dans la file.
L'en-tête du panneau conserve le bouton de fermeture à portée, même après
défilement vers un autre livre ; sa hauteur s'adapte aux langues et au paysage.

Le découpage automatique à 180 caractères est remplacé par des phrases
complètes, en conservant les positions du texte, les abréviations et les
retours de ligne internes. Si une phrase dépasse le contexte de Kokoro, ses
fragments sont générés successivement puis assemblés dans un seul WAV avant
de devenir disponibles à l'écoute. Cela peut augmenter l'attente du premier
passage mais supprime les attentes de calcul entre ses fragments.

Les préparations utilisent une nouvelle version de segmentation. Les anciens
enregistrements restent lisibles : le lecteur réunit les fragments déjà
stockés et attend une phrase entière avant de la jouer, sans les supprimer
ni lancer de nouvelle génération.

La suite complète compte désormais **956 tests unitaires réussis** dans
56 fichiers. Elle couvre aussi les pannes Worker pendant et entre les
fragments : une erreur de génération reste visible, sans être confondue avec
une annulation. Les builds standard et Pages, ainsi que les six contrôles
Pages avec relais simulé, ont été repassés avec succès.

Les **63 tests navigateur ciblés** de la voix, de la file, des anciens audios
et de la disposition passent sur les trois configurations. Le cas de migration
part d'un seul fragment enregistré, vérifie l'attente, ajoute le second puis
contrôle un WAV unique contenant exactement tous les échantillons, le texte
surligné et l'absence de Worker. Sur WebKit, le test bloque HTTP(S) plutôt que
d'utiliser `setOffline(true)` : cette émulation Playwright faisait échouer
même la lecture d'un Blob créé en mémoire, indépendamment de FastReader.

Les captures finales de la file en français et allemand, à 320 × 640 et
640 × 320, confirment que le titre long, le statut et la fermeture restent
accessibles, sans débordement ni violation axe ciblée. Elles sont conservées
dans `.cache/audio-queue-header-visual/`.

Une vérification supplémentaire avec le **modèle réel, hors ligne**, a produit
une phrase de 671 caractères : deux générations ont été réunies en un seul
WAV de **37,375 secondes**, avec conservation de chaque échantillon et lecture
par l'élément Audio natif. Les mesures de continuité, de multicœur et de deux
Workers figurent dans [VOICE-PERFORMANCE.md](VOICE-PERFORMANCE.md). Ils ont
conduit à l’activation automatique décrite ci-dessous.

## Démarrage anticipé, accélération et progression

Validation finale : **1 003 tests unitaires** dans 57 fichiers et **78 tests
navigateur ciblés audio** réussis sur les configurations bureau Chromium,
téléphone Chromium et tablette WebKit. Les builds standard et Pages, ainsi
que les six contrôles Pages avec relais simulé et reprise hors ligne, passent.
Les anciennes fixtures imposent explicitement un profil portable et distinguent
le préchauffage des conversions de la file ; les nouveaux scénarios vérifient
aussi la concurrence à deux Workers et l’absence de régénération au clic.

Le choix d’une voix déjà installée déclenche une préparation silencieuse du
début, tant qu’aucun livre n’occupe déjà la file. Le clic sur « Lancer l’écoute »
réutilise le modèle et le premier son ; aucun audio n’est joué avant ce clic.
Fermer le choix, changer pour une langue indisponible, naviguer ou mettre en
pause annule également une anticipation encore en attente de la base locale.

Le lecteur prépare ensuite jusqu’à six phrases au total, avec une cible de
30 secondes **après** la phrase courante et un budget de 8 Mio. Une phrase
longue de 40 secondes n’empêche donc pas la génération de la suivante pendant
son écoute. La première phrase prête peut jouer sans attendre les suivantes,
même si un résultat ultérieur arrive avant elle. Les limites de mémoire,
erreurs d’une phrase future et annulations des tâches parallèles sont testées.

Sur les appareils déclarant assez de mémoire et de processeurs logiques,
deux Workers traitent les phrases en parallèle, ou un modèle utilise plusieurs
threads si l’hébergement est isolé. Le second Worker reste différé jusqu’à
une demande réelle ; une panne de ce modèle reprend la phrase intégralement
sur le premier. Les livres de la file restent ordonnés et leurs enregistrements
sont validés dans l’ordre de lecture, même quand les calculs sont simultanés.

Le panneau affiche immédiatement une étape de chargement puis les phrases et
secondes prêtes. Aucun pourcentage d’inférence n’est simulé. Les compteurs
restent hors de la région annoncée aux lecteurs d’écran ; un message inchangé
n’est pas recréé à chaque événement du moteur. Les six langues et trois thèmes
ont été contrôlés sur Chromium et WebKit, en portrait 320 × 640 et paysage
640 × 320 : aucun débordement ni violation axe ciblée, Pause accessible.

L’essai réel hors ligne avec « Camille ouvre son livre. » a préparé
silencieusement 1,95 seconde d’audio en 4,51 secondes. Le démarrage réutilisant
ce résultat a pris **62 ms**, avec un seul Worker et une seule synthèse avant
et après le clic. Le benchmark de deux phrases sur le même PC est passé de
**47,32 à 24,69 secondes** avec le pool parallèle. Ces mesures concernent le
moteur intégré et le lecteur audio natif ; elles ne promettent pas un démarrage
instantané à froid ou une génération sans pauses sur tout téléphone.

## Contrôle avant publication

Avant publication, la suite navigateur complète a été exécutée : **441 tests
réussis** sur bureau Chromium, téléphone Chromium et tablette WebKit. L’audit
npm complet ne signale aucune vulnérabilité. Ces résultats complètent les
1 003 tests unitaires et les contrôles Pages décrits plus haut.

Un build Docker propre a aussi été lancé puis testé sur un port local
éphémère. Le serveur répond sur `/api/health`, les fichiers Worker, MJS, WASM
et l’archive des sources GPL sont accessibles avec les types MIME attendus,
et l’empreinte du Worker correspond au manifeste. L’image finale contient
les dépendances de production nécessaires au serveur et s’exécute sous
l’utilisateur `node`, sans modèle vocal ni dépendances de développement.
Le pipeline vérifie désormais le démarrage de cette image avant de la publier.

Le premier contrôle GitHub a ensuite révélé un clic perdu sur « Annuler »
dans la file audio : une mise à jour de progression remplaçait le bouton
entre l’appui et le relâchement. Les lignes, commandes et leurs descendants
sont maintenant conservés, ainsi que le focus clavier. Un nouveau test
maintient le pointeur enfoncé pendant la fin d’un passage : il reproduit
l’échec sur les trois moteurs avant correction et réussit après correction.
Les **81 contrôles navigateur audio** et **22 tests unitaires du panneau**
ont été revalidés. Le simulateur de Worker retire aussi ses callbacks annulées
afin qu’une ancienne préparation silencieuse ne soit plus confondue avec une
génération active dans les tests manuels de changement de chapitre.

## Limites restant à vérifier

Ces essais ne valident pas la fluidité, la mémoire, la batterie ou la stabilité
sur **de vrais iPhone et Android**. Les formats mobiles des tests de navigateur
vérifient l’interface, pas les capacités matérielles d’un téléphone.

Il reste à écouter des extraits longs contenant narration, dialogues, noms
propres et nombres, puis à tester des sessions prolongées sur plusieurs
appareils physiques. L’application se met actuellement en pause lorsqu’elle
passe en arrière-plan, y compris au verrouillage de l’écran ; l’écoute avec
l’écran verrouillé n’est donc pas une fonctionnalité validée ou annoncée.

Les WAV, mesures JSON et scripts de ces essais ponctuels sont conservés dans
le dossier de travail non versionné `.cache/voice-engine-check/`. Ce rapport
versionné conserve les méthodes, les textes et les résultats nécessaires pour
distinguer ces essais réels des validations automatisées avec fixtures.
