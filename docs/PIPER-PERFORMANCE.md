# Piper Medium : mesures des possibilités d’accélération

Mesures du 15 septembre 2026. Elles utilisent la voix française Siwis Medium,
les modèles et le runtime déjà téléchargés, sur un **Intel Core i5-13600KF,
Linux x64, 16,7 Go de RAM**, dans Playwright 1.63.0. Aucun téléphone physique
n’a été mesuré et aucune limitation artificielle du processeur n’a été utilisée.

## Méthode

Le même extrait de six phrases, soit 114 mots, produit environ 35 secondes
d’audio à la vitesse vocale normale. Chaque configuration démarre dans un
nouveau navigateur, charge sa ou ses instances, puis effectue un échauffement.
Trois répétitions mesurées suivent, avec rotation de l’ordre des phrases.
Le tableau présente leur médiane ; le chargement initial est exclu.

Une seconde mesure de la configuration de base, à la fin, retrouve 4,92 s
sous Chromium et 4,91 s sous WebKit. Les bases initiales sont respectivement
4,93 s et 4,94 s. Les suites navigateur de l’application étaient suspendues
pendant ces mesures afin de limiter la concurrence pour le processeur.

Le banc instrumente la phonémisation, l’inférence et la copie PCM. Il conserve
les limites de phrases natives de Piper, la même voix et la même vitesse.
Les groupes de deux phrases restent sous 468 identifiants phonétiques, donc
sous la limite de 1 024 utilisée par le lecteur. La synthèse s’effectue réseau
coupé après chargement ; aucune requête ni erreur JavaScript n’est observée.
Les 30 répétitions produisent un signal non silencieux et des échantillons
finis. Ces contrôles ne constituent pas un test d’écoute ou de compréhension.

## Débit de synthèse

| Configuration | Chromium 153 | WebKit 26.6 | Première sortie Chromium |
| --- | ---: | ---: | ---: |
| Une instance, un thread, une phrase par appel | 4,93 s | 4,94 s | 0,88 s |
| Deux instances, un thread chacune | 2,56 s | 2,54 s | 0,79 s |
| Une instance, deux threads, isolation réelle | 2,71 s | Non mesuré | 0,47 s |
| Une instance, quatre threads, isolation réelle | 1,72 s | Non mesuré | 0,31 s |
| Une instance, un thread, deux phrases par appel | 5,11 s | 5,06 s | 1,70 s |

Les deux instances réduisent ici le temps total d’environ 48 %, mais accélèrent
peu l’arrivée de la première phrase. Deux ou quatre threads dans une même
instance améliorent aussi cette première sortie sur cette machine.

Regrouper les phrases n’apporte aucun gain sur cet extrait et retarde l’écoute.
Plus de 99 % du temps mesuré à l’intérieur du moteur, dans la configuration
à un thread, est consacré à l’inférence. Réduire les appels au phonémiseur ou
les copies PCM ne peut donc pas, à lui seul, accélérer fortement la conversion.

## Coût mémoire et téléphone

| Configuration | Pic RSS agrégé Chromium | Pic RSS agrégé WebKit |
| --- | ---: | ---: |
| Une instance, un thread | 694 Mio | 1 043 Mio |
| Deux instances, un thread chacune | 970 Mio | 1 355 Mio |
| Une instance, deux threads | 700 Mio | Non mesuré |
| Une instance, quatre threads | 679 Mio | Non mesuré |

Ces valeurs additionnent le RSS des processus du navigateur, relevé toutes
les 100 ms. Elles incluent son fonctionnement général et peuvent compter
plusieurs fois des pages mémoire partagées. Ce ne sont ni la mémoire WASM
seule ni la consommation d’un téléphone. Les petites différences entre les
configurations à une instance ne démontrent pas une réduction de mémoire.

Deux instances ajoutent néanmoins environ 276 Mio au pic agrégé Chromium,
et 312 Mio sous WebKit, dans ce test. Un doublement automatique des instances
sur téléphone n’est pas validé : il faut mesurer le gain, la mémoire et la
chauffe sur des appareils réels, notamment pendant une préparation longue.
Le choix actuel d’une seule instance sur téléphone reste conservateur.

## Limitation du déploiement GitHub Pages

Le site publié a été vérifié dans un nouveau contexte Chromium :
`crossOriginIsolated` vaut `false`, `SharedArrayBuffer` est absent, et la réponse
HTTP ne contient ni `Cross-Origin-Opener-Policy` ni
`Cross-Origin-Embedder-Policy`.

Le multithreading WASM exige cette isolation. Augmenter simplement
`numThreads` ne l’active pas. Le support de deux instances sur les ordinateurs
suffisamment équipés existe déjà dans FastReader. Pour bénéficier des threads
partagés, il faut d’abord une stratégie d’hébergement et d’isolation compatible
avec les couvertures, les sources, les téléchargements et le fonctionnement
hors ligne, puis des mesures sur téléphone.
[Configuration officielle ONNX Runtime](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html#envwasmnumthreads).

## Coût évitable du stockage entre deux phrases

Un contrôle séparé utilise IndexedDB, dans un profil navigateur jetable, avec
un ou dix livres de 100 000 mots. Chaque préparation possède 5 000 passages ;
son enregistrement JSON représente environ 0,99 Mo. Vingt passages de 15 s,
soit 661 500 octets chacun, sont enregistrés dans l’ordre. Les médianes
ci-dessous excluent l’inférence et le rendu de l’interface.

| Opération après un passage | Chromium : un livre | Chromium : dix livres | WebKit : un livre | WebKit : dix livres |
| --- | ---: | ---: | ---: | ---: |
| Relire le livre courant | 2,5 ms | 2,5 ms | 2 ms | 2 ms |
| Enregistrer le passage et son avancement | 8,3 ms | 8,1 ms | 7 ms | 7 ms |
| Relire toutes les préparations, le bail et les verrous | 2,7 ms | 23,2 ms | 2 ms | 12 ms |

La relecture globale répète un travail qui augmente avec la bibliothèque.
Réutiliser le livre que la transaction vient de renvoyer permet d’éviter ce
coût après chaque passage, en conservant la transaction atomique et la
synchronisation entre onglets. Cela représente une optimisation mesurée de
l’orchestration ; ces nombres ne démontrent pas une multiplication du débit de
Piper ni un gain identique sur téléphone. L’estimation du quota, à environ
0–0,3 ms ici, ne justifie pas de supprimer la vérification de place disponible.

## Recommandation

1. Éviter les relectures globales inutiles et les tentatives répétées sur les
   mêmes passages problématiques, sans modifier la voix ni le rythme parlé.
2. Conserver une phrase complète par passage et une seule instance sur mobile
   tant que les essais sur de vrais appareils ne valident pas une autre politique.
3. Évaluer ensuite une instance à deux threads sous isolation : le test PC
   montre un gain avec moins de duplication qu’avec deux modèles indépendants.
4. Ne présenter WebGPU ou une quantification du modèle comme une accélération
   qu’après un benchmark du modèle exact et une comparaison d’écoute. Aucun
   gain n’a été mesuré ici pour ces options.

La documentation ONNX Runtime recommande de mesurer les fournisseurs
CPU/GPU selon le modèle et distingue bien l’exécution dans un Worker, utile
pour la réactivité de l’interface, d’un gain de calcul réel.
[Guide officiel de diagnostic des performances](https://onnxruntime.ai/docs/tutorials/web/performance-diagnosis.html).

Les scripts, corpus, journaux et résultats détaillés de cette session sont
conservés localement dans `.cache/piper-speed-audit/`, notamment `bench.mjs`,
`storage-bench.mjs`, `summary.json` et `production-isolation.json`.
