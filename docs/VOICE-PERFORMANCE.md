# Préparation vocale : performance et continuité des phrases

> **Archive — ancien moteur Kokoro.** Ces essais décrivent l’implémentation précédente, avant le passage à Piper Medium. Les noms de voix, tailles, politiques mobiles et mesures ci-dessous ne décrivent pas le moteur actuel. Voir [les vérifications Piper](PIPER-VERIFICATION.md) et [le guide de la lecture vocale](LOCAL-VOICE.md).

Vérification du 14 septembre 2026. **L’accélération est activée automatiquement lorsque les capacités déclarées du navigateur le permettent.** Le modèle Kokoro q8 et les voix restent identiques ; seul le petit fichier du Worker est mis à jour. Le moteur choisit deux sessions parallèles ou plusieurs threads dans une session, avec un mode portable sur les autres appareils. Aucun gain GPU ni gain mesuré sur téléphone n’est annoncé.

## Politique activée

| Capacités déclarées | Exécution choisie |
| --- | --- |
| Bureau : au moins 8 Gio de mémoire et 4 processeurs logiques | 2 Workers, chacun avec un modèle et un thread WASM |
| Mobile : au moins 8 Gio de mémoire et 8 processeurs logiques | 2 Workers, chacun avec un modèle et un thread WASM |
| Même appareil capable, avec isolation interorigines vérifiée | 1 modèle, 2 threads avec 4 processeurs logiques, ou 4 threads à partir de 8 |
| Mémoire inconnue, capacités inférieures ou non disponibles | 1 Worker, 1 modèle, 1 thread WASM |

La mémoire provient de [`navigator.deviceMemory`](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory) : c’est une capacité approximative déclarée par le navigateur, pas la mémoire libre garantie à FastReader. Une valeur absente reste en mode portable. Les seuils mobiles sont plus prudents ; les vrais iPhone et Android n’ont pas encore été mesurés.

Le premier Worker reste prioritaire. `load()` attend uniquement son modèle. Le second modèle n’est créé que lorsqu’une deuxième phrase lui est réellement confiée ; son chargement se déroule alors pendant le traitement de la première. Une phrase unique ne charge donc pas une deuxième copie du modèle. Chaque Worker traite ses demandes dans l’ordre, sans entrelacer les fragments d’une phrase. Si la deuxième session signale une panne, le moteur réduit sa concurrence à un et retente la phrase complète sur la première. Les annulations et les erreurs de contenu ne déclenchent pas cette nouvelle tentative.

Les modèles sont réutilisés pendant la session. Le lecteur peut préparer silencieusement le début avant le clic de lecture, puis réutiliser exactement cet audio. Il maintient ensuite une réserve bornée de phrases complètes ; les livres de la file restent ordonnés, tandis que les phrases d’un même livre peuvent être calculées en parallèle. Les en-têtes HTTP globaux du site ne sont pas modifiés.

## Mesures du code intégré après activation

Le moteur final, son Worker publié, le cache vocal et l’élément audio natif ont été testés sur le même PC décrit ci-dessous. Après installation des fichiers dans le cache, le réseau était coupé. Les profils portable et parallèle utilisent respectivement une capacité mémoire injectée de 4 et 8 Gio pour sélectionner les deux chemins sur le même ordinateur ; le profil multicœur ajoute les en-têtes d’isolation au seul serveur de test. Le Worker a confirmé respectivement 1, 1 et 4 threads effectifs.

Deux appels de synthèse sont lancés ensemble avec la même phrase française de 276 caractères. Le mode portable les sérialise, le pool les répartit. Les mesures incluent l’ordonnancement du moteur, les phonèmes, la génération et l’encodage. Le chargement initial du premier modèle est présenté séparément. Un essai par configuration a été réalisé après les essais de diagnostic répétés décrits plus bas.

| Configuration finale | Chargement du premier modèle | Premier WAV disponible après les demandes | Deux WAV disponibles | Temps économisé pour la paire |
| --- | ---: | ---: | ---: | ---: |
| Portable, 1 Worker / 1 thread | 1,33 s | 23,81 s | 47,32 s | Référence |
| Parallèle, 2 Workers / 1 thread chacun | 1,15 s | 24,13 s | 24,69 s | 47,8 % |
| Isolé, 1 Worker / 4 threads | 1,08 s | 14,27 s | 28,20 s | 40,4 % |

Les deux WAV de chaque configuration durent 15,55 secondes et contiennent chacun 746 444 octets. Le premier a été lu par l’élément audio natif dans chaque configuration. Le pool accélère surtout la préparation de la suite : il ne réduit pas automatiquement le temps de calcul de la première phrase. Le lancement n’attend jamais le chargement du second modèle.

**Démarrage après préparation silencieuse :** avec le vrai `createVoicePlayback`, la phrase « Camille ouvre son livre. » a demandé 4,51 secondes de préparation hors ligne, sans lecture audio. Une fois prête, `start()` avec la même voix, le même texte et la même position a commencé la lecture native en **62 ms** (`currentTime > 0`, `paused: false`). Le nombre de Workers est resté à un et le nombre de synthèses à un : aucune nouvelle génération n’a été faite au clic. Le fichier dure 1,95 seconde. Ce délai concerne une phrase déjà préparée, pas un premier téléchargement ou une génération à froid.

Les étapes remontées sont réelles : chargement du modèle local, octets chargés quand ils sont connus, phonémisation, synthèse, fragments terminés et durée audio produite. Aucun pourcentage d’inférence n’est fabriqué.

## Correction des phrases coupées

L’ancien découpage limitait chaque passage à 180 caractères, même au milieu d’une phrase. Il pouvait donc imposer une attente de génération après une proposition inachevée. Le découpage privilégie désormais les phrases entières, avec conservation de leurs positions dans le texte.

Le modèle accepte au maximum 512 tokens, dont les deux marqueurs de bord. Cette limite porte sur le texte phonétisé, pas sur le nombre de caractères français. La [fiche officielle du modèle ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) décrit cette contrainte.

Le Worker utilise `truncation: false` et refuse explicitement un passage trop long. `createVoiceEngine.synthesize()` peut alors le partager à des frontières naturelles, préparer les fragments successivement avec **le même Worker**, puis réunir leurs échantillons PCM dans un unique WAV. Le lecteur ne reçoit la phrase qu’une fois son audio complet disponible. La récursion est limitée à huit niveaux ; une phrase impossible à traiter déclenche une erreur, sans rendre un fragment incomplet.

L’assemblage préserve tous les échantillons, y compris les silences de fin, sans fondu ni retrait de son. Il vérifie le format PCM mono 16 bits/24 kHz, corrige les longueurs RIFF et recalcule la durée à partir des échantillons. Le même utilitaire permet de réunir les anciens fragments déjà enregistrés. L’annulation termine le Worker et empêche un résultat tardif ou une nouvelle sous-génération.

Cela supprime les attentes de calcul au milieu de la phrase préparée. Une très longue phrase qui dépasse le contexte du modèle reste composée de plusieurs synthèses et peut garder une transition de prosodie à leur jonction. Une évaluation humaine demeure nécessaire pour juger le naturel de ces transitions.

**Vérification du moteur intégré, hors ligne :** une phrase française de 671 caractères a provoqué le refus initial attendu, puis deux générations successives de 19,125 et 18,25 secondes d’audio. Le moteur a retourné un seul WAV de 37,375 secondes et 1 794 044 octets, soit exactement la somme des échantillons. Un seul Worker a été créé. Le lecteur audio natif a commencé à lire ce fichier (`currentTime > 0`, `paused: false`). L’ensemble a pris 63,34 secondes sur le PC de test, chargement et démarrage audio inclus. Le modèle et le runtime provenaient du cache local ; le réseau était coupé pendant la synthèse.

## Diagnostic CPU préalable

- Chromium 153.0.8010.12 via Playwright 1.63.0, Linux x64 dans Docker.
- Intel Core i5-13600KF, 20 processeurs logiques ; navigateur de bureau, **aucun téléphone physique**.
- Transformers.js 3.8.1, ephone 1.0.2, Kokoro q8 à la révision `1939ad2a8e416c0acfeecc08a694d14ef25f2231`, voix française Siwis.
- Fichiers déjà présents sur disque, servis localement ; aucun nouveau téléchargement de modèle.
- Une phrase française de 276 caractères, 256 tokens, produisant 15,55 secondes d’audio. Une courte génération d’échauffement précède deux mesures de la même phrase.
- Le chargement du modèle et la phonémisation sont exclus du temps d’inférence présenté. Les essais ne tournent pas simultanément.
- Le Worker instrumenté conserve le chemin de synthèse du moteur : même modèle, phonémisation française, style, vitesse et sortie WAV ; seul le nombre de threads change.

| Exécution d’un modèle | Isolation du serveur de test | Inférence moyenne | Réduction du temps | Calcul / durée audio |
| --- | --- | ---: | ---: | ---: |
| 1 thread WASM | Non | 23,34 s | Référence | 1,50 |
| 2 threads WASM | Oui | 17,01 s | 27,1 % | 1,09 |
| 4 threads WASM | Oui | 13,90 s | 40,5 % | 0,89 |

Les deux mesures individuelles sont respectivement 23,483/23,203 s ; 17,055/16,971 s ; 14,068/13,726 s. Les trois configurations ont produit le même nombre d’échantillons et les mêmes mesures de fin de signal. Un passage de 1 471 tokens a été refusé dans les trois configurations.

Ces valeurs montrent un gain sur ce CPU pour ce passage. Elles ne garantissent pas le même facteur sur d’autres textes, navigateurs, téléphones, ou pendant une utilisation prolongée avec chauffe et économie de batterie.

## Multicœur et hébergement

ONNX Runtime Web exige le support des threads WebAssembly **et** `crossOriginIsolated` pour utiliser plusieurs threads. `numThreads` inclut le thread principal du Worker. Ajouter un Worker de façade améliore la réactivité de l’interface, sans accélérer l’inférence ; FastReader utilise déjà un Worker dédié. Voir les [options WASM d’ONNX Runtime](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html) et son [guide de performance](https://onnxruntime.ai/docs/tutorials/web/performance-diagnosis.html).

Le serveur expérimental a utilisé `Cross-Origin-Opener-Policy: same-origin` et `Cross-Origin-Embedder-Policy: require-corp`. Le contrôle HTTP du site GitHub Pages public, effectué le 14 septembre 2026, ne trouve aucun de ces deux en-têtes. Modifier `numThreads` seul n’y activerait donc pas le multicœur.

L’isolation exige aussi de vérifier les ressources externes : couvertures, catalogues, scripts et fenêtres tierces peuvent être affectés. Le [guide du navigateur sur l’isolation](https://web.dev/articles/cross-origin-isolation-guide) décrit ces conséquences. Une activation doit être testée sur l’hébergement final et sur l’ensemble des sources avant de changer les en-têtes de FastReader.

Le moteur active désormais **plusieurs threads dans un seul modèle** sur les appareils capables lorsque le document est isolé. Le Worker vérifie lui-même l’isolation et la présence de `SharedArrayBuffer` avant de les utiliser. GitHub Pages conserve le chemin parallèle à deux modèles sur les appareils capables, car son hébergement actuel ne fournit pas cette isolation.

## Deux conversions en parallèle

Un essai supplémentaire a chargé **deux Workers indépendants**, chacun avec son propre modèle q8 et un thread WASM. Aucune isolation du serveur n’était nécessaire. Après chargement et échauffement séparés, les deux Workers ont reçu la même phrase de 276 caractères simultanément.

| Traitement de deux passages identiques | Temps total mesuré |
| --- | ---: |
| Un Worker, les deux essais séquentiels du protocole précédent | 46,69 s |
| Deux Workers, un passage chacun simultanément | 23,27 s |

Le débit a donc presque doublé sur ce PC. Chaque passage a gardé ses 15,55 secondes d’audio, sans valeur non finie ni phonème inconnu. Il s’agit d’un seul essai de la paire parallèle, comparé aux deux essais séquentiels précédents ; le chargement initial des deux modèles n’est pas inclus.

La mémoire résidente du processus de rendu, lue dans `/proc/<pid>/status`, était de **531 Mio après l’échauffement court d’un modèle**, puis **855 Mio après celui du deuxième**. Après la génération parallèle des deux passages longs, elle atteignait **1 162 Mio, soit environ 1,13 Gio**. Ce sont des instantanés RSS du processus de rendu, pas une mesure du pic total du navigateur. Les deux premiers instantanés utilisent le même court extrait d’échauffement ; le dernier suit une charge plus longue et ne doit pas être comparé comme s’il représentait la même étape.

Les conversions en parallèle sont donc techniquement possibles et efficaces sur cette machine. Elles sont maintenant activées selon les seuils de capacité décrits en tête de rapport. La stabilité, la chauffe et la consommation sur iPhone et Android n’ont pas été mesurées. Le mode portable reste utilisé lorsque le navigateur ne déclare pas une capacité suffisante. Ces mesures ne promettent pas de multiplier la vitesse sur tous les appareils.

## Autres pistes

**WebGPU.** Transformers.js permet de demander `device: 'webgpu'`, comme indiqué dans sa [documentation version 3.8.1](https://huggingface.co/docs/transformers.js/v3.8.1/en/guides/webgpu). Dans cet environnement de test, `navigator.gpu` existe mais `requestAdapter()` renvoie `null` ; aucune carte compatible n’est accessible. Aucun gain GPU n’a donc été mesuré. Une sélection automatique demanderait de tester le modèle, les opérations supportées, la mémoire et la reprise CPU sur de vrais appareils.

**Variante uint8.** Le prototype antérieur, avec les mêmes quatre extraits français, mesurait environ 15 à 19 % de temps d’inférence en moins qu’avec q8. Cette variante pèse toutefois 177 464 632 octets contre 92 361 116 pour le modèle actuel, soit 85 Mo supplémentaires à télécharger et conserver. Ces premiers résultats ne justifient pas un remplacement automatique pour un public principalement mobile. Les variantes proposées et leurs tailles sont documentées dans la [fiche du modèle](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX).

## Contrôle des fins de fichiers

Le Worker écrit exactement les échantillons retournés par le modèle. Sur les sept WAV du contrôle intégré précédent — cinq langues dans Chromium, français dans Firefox et WebKit — les 50 dernières millisecondes contiennent du silence PCM ; le dernier signal supérieur à environ −60 dB précède la fin de 182 à 461 ms. Sur la phrase du benchmark, la fin du signal est également conservée : 373 200 échantillons et un WAV de 746 444 octets.

Ces contrôles excluent une coupe des échantillons dans l’encodeur pour les fichiers examinés. Ils ne prouvent pas que le modèle prononce parfaitement chaque mot et ne remplacent pas une écoute humaine.

## Reproduction et limites

Les scripts du diagnostic préalable sont dans `.cache/voice-perf-diagnostic/` : `server.mjs`, `check.mjs`, `parallel.mjs` et `real-sentence.mjs`. Les mesures du code activé se trouvent dans `.cache/voice-accelerated-check/` : `check.mjs`, `result.json`, `warm-playback.mjs` et `warm-playback.json`. Le Worker testé fait 7 350 octets, SHA-256 `f740837aeb63b8248b0e31557633013ec50e9fdae8159eaf65f3de7acf957f5f`. Les données brutes sont conservées pour la session ; ces caches et les gros modèles ne sont pas versionnés. Le présent rapport conserve les résultats utiles indépendamment de ces fichiers temporaires.

Les 36 tests unitaires du moteur, du pool et de l’assemblage vérifient les seuils de capacité, la création différée du second modèle, la concurrence et l’ordre par Worker, la réutilisation, le repli après panne, les progrès réels, les formats WAV, la préservation des échantillons, la limite de récursion, l’annulation et le rejet des réponses tardives. Les validations de l’interface et de la file sont décrites séparément dans [VOICE-VERIFICATION.md](VOICE-VERIFICATION.md).
