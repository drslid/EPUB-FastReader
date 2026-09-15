# Piper Medium : intégration et vérifications

Vérification du 15 septembre 2026. Ce rapport concerne le worker Piper intégré
à FastReader. Les rapports [de vérification Kokoro](VOICE-VERIFICATION.md) et
[de performance Kokoro](VOICE-PERFORMANCE.md) restent des archives.

## Ce qui change pour la lecture

- Six voix Medium : Siwis (français), LJ Speech (anglais), Davefx (espagnol),
  Paola (italien), Thorsten (allemand), Faber (portugais brésilien).
- Environ 93 Mo pour une première voix : modèle de 63 Mo et moteur partagé de
  30 Mo. Chaque langue supplémentaire possède son propre modèle d’environ
  63 Mo. La taille manquante exacte apparaît avant le téléchargement.
- Téléchargement explicite, avec progression, annulation, contrôle SHA-256 et
  reprise des fichiers déjà terminés. La synthèse utilise uniquement le cache.
- Une seule instance et un seul thread WASM sur téléphone et tablette. Sur
  ordinateur suffisamment équipé, deux instances restent possibles, ou deux
  à quatre threads dans une instance si le document est isolé.
- La préparation en file, l’écoute du début pendant la préparation, les pauses
  et le regroupement des fragments d’une longue phrase sont conservés.

Les modèles et leurs configurations sont figés à la révision
`1162a9173d0ce503555aed757976b7a9912eae4c` de `rhasspy/piper-voices`.
Leurs licences et les sources du moteur sont détaillées dans
[THIRD-PARTY-VOICE.md](THIRD-PARTY-VOICE.md).

## Génération réelle dans les navigateurs

Matériel : **Intel Core i5-13600KF, x64**, navigateur de bureau exécuté dans
le conteneur Playwright 1.63.0. Aucune mesure sur téléphone physique.
Le worker utilise un thread WASM ; les fichiers sont installés localement
avant le test. Chaque langue démarre dans un nouveau contexte navigateur.

Les six voix ont produit des WAV mono 22 050 Hz dans **Chromium et WebKit**,
soit douze générations. Chaque extrait comporte deux phrases de narration.
Les fichiers ont un signal non silencieux et des échantillons valides.
Aucun appel externe ni erreur JavaScript n’a été observé pendant la synthèse.

Les mesures Chromium suivantes ont été effectuées avant les suites de tests
concurrentes. Ce sont des essais courts de fonctionnement, sans répétitions :
elles ne remplacent pas le benchmark comparatif préalable.

| Voix | Chargement depuis le cache | Génération du passage | Audio produit |
| --- | ---: | ---: | ---: |
| Siwis — FR | 0,84 s | 1,16 s | 7,86 s |
| LJ Speech — EN | 0,90 s | 1,09 s | 7,40 s |
| Davefx — ES | 0,83 s | 1,12 s | 7,50 s |
| Paola — IT | 0,91 s | 0,94 s | 6,14 s |
| Thorsten — DE | 0,79 s | 1,01 s | 6,62 s |
| Faber — PT-BR | 0,80 s | 0,97 s | 6,33 s |

Sous Chromium, le mode hors ligne était activé avant la première création du
worker. Sous WebKit, la simulation `setOffline(true)` de Playwright provoque
une erreur interne au chargement d’un worker pourtant en cache. Comme pour
la vérification antérieure, le serveur HTTP dédié a donc été **réellement
arrêté avant la création du worker**, sans cette simulation. Les six voix ont
réussi ce contrôle ; les chronos WebKit, pris pendant d’autres tests, ne sont
pas utilisés pour comparer les performances.

Cela valide une génération sans réseau après installation de l’application,
du livre et de la voix. Une première installation nécessite une connexion.

## Longues phrases, annulation et variantes de calcul

Un passage français de **1 365 caractères / 230 mots** a été généré avec le
moteur réel dans Chromium et WebKit, serveur HTTP arrêté. Il dépasse la limite
d’un appel : quatre fragments (817, 423, 753 et 627 identifiants phonétiques)
sont assemblés avant de rendre le son au lecteur.

Ce contrôle a détecté puis permis de corriger une ancienne contrainte de
l’assembleur WAV à 24 000 Hz. L’assemblage accepte maintenant le **22 050 Hz
Piper** et le **24 000 Hz Kokoro**, en conservant chaque échantillon et en
refusant de mélanger deux fréquences dans une même phrase. Les durées sont
calculées depuis les échantillons, sans modifier la hauteur de la voix.

L’annulation après phonémisation interrompt le vrai worker ; une nouvelle
synthèse recrée un worker et réussit hors ligne. Deux instances Piper en
parallèle ont également généré des passages complets sans repli. Un contrôle
séparé sous COOP/COEP confirme une instance avec deux threads WASM, serveur
arrêté. Ces essais valident le fonctionnement ; leurs chronos ne servent pas
à annoncer un gain de vitesse.

Les six configurations ont aussi été téléchargées depuis un navigateur avec
contrôle de taille et SHA-256. Les six URLs des modèles répondent au contrôle
HTTP HEAD après redirection avec les autorisations CORS nécessaires. Les
poids complets utilisés dans les essais ont été vérifiés séparément.

## Vérification automatique du contenu parlé

Au total, les contrôles ont produit **20 WAV valides** et **16 transcriptions**.
Les WAV ont été transcrits **localement** avec Whisper Small multilingue,
révision `536b0662742c02347bc0e980a01041f333bce120`, int8, deux threads,
langue imposée par extrait, sans fournir le texte attendu au transcripteur.
Les fins des six extraits sont retrouvées dans les deux navigateurs.

L’anglais court est transcrit exactement ; les autres langues présentent des
écarts de reconnaissance, notamment homophones et séparation des mots.
L’italien est moins bien reconnu autour de « ritrovò il suo segnalibro »
(35 % d’erreurs de mots sur le court extrait Chromium). Ce résultat peut
venir de la prononciation et du transcripteur : **il ne mesure pas le naturel**
et mérite une vérification humaine. Aucune qualité uniforme des six voix
n’est promise.

Le passage long Chromium produit 70,79 secondes d’audio ; sa transcription
retrouve la fin « son marque-page sur la table » (6,5 % d’erreurs de mots).
WebKit retrouve aussi la dernière phrase (7,4 %), avec « marque-pache »
reconnu pour « marque-page ». Un prénom intermédiaire manque dans la
transcription Chromium mais apparaît dans celle de WebKit. Aucun fragment
entier ne disparaît aux jonctions ; ces résultats ne certifient toutefois
pas une restitution parfaite de chaque mot.

## Conservation des données existantes

Les nouveaux fichiers utilisent `fastreader-voice-v2`. Le service worker
préserve le cache v1 pour les anciens onglets ; une nouvelle interface ne
reprend jamais une conversion avec une voix retirée.

Les audios Kokoro complets et partiels restent dans la base audio locale et
peuvent être écoutés. Une conversion Piper crée une préparation distincte,
identifiée par le livre, son texte, la voix et les empreintes du modèle et de
sa configuration. Aucun segment Piper n’est ajouté à une préparation Kokoro.
Les anciennes voix restent associées à leurs audios au changement de chapitre.

La suppression facultative de l’ancien moteur efface uniquement ses fichiers
pour ce déploiement. Elle conserve les livres, les audios préparés, les voix
Piper et les autres applications du même domaine. Les sauvegardes ZIP gardent
leurs réglages vocaux sans embarquer modèles ou WAV volumineux.

## Nettoyage global et optimisation avant publication

La commande **Préparations audio → Vider les audios** affiche la place occupée
et demande une confirmation. Elle arrête l’écoute et les conversions, puis
vide atomiquement les préparations, leurs fichiers audio et le verrou de
conversion. Les livres, repères et modèles de voix sont conservés.

Un compteur conservé en base invalide les préparations et résultats démarrés
avant la suppression, y compris si le même livre est préparé à nouveau. Les
onglets reçoivent une notification d’arrêt ; une ancienne lecture de la base
ne peut plus réafficher les lignes supprimées. Les tests couvrent aussi les
segments orphelins, les erreurs de stockage et le rollback de la suppression.
Le nettoyage utilise les opérations de la base sans charger les WAV en mémoire.

Le contrôle des voix disponibles réutilise les lectures des fichiers partagés
pendant chaque consultation : **21 lectures de cache au lieu de 66** pour les
six voix. Une consultation suivante détecte toujours les fichiers évincés.
L’override `sharp` devenu inutile et un compteur de traitement inutilisé ont
été retirés. L’audit des dépendances de production ne signale aucune
vulnérabilité ; l’image Docker a été reconstruite et son endpoint de santé testé.

## Tests de l’application

- **1 061 tests unitaires**, dans 59 fichiers, réussis après correction.
- **453 scénarios navigateur distincts** validés sur bureau Chromium,
  téléphone Chromium simulé et tablette WebKit simulée : 452 lors de la suite
  complète, puis 24 contrôles d’écoute et de nettoyage réussis après correction
  de la synchronisation d’un événement audio simulé dans le dernier test.
  Le nettoyage global est testé à 320 px, avec annulation, arrêt de l’écoute,
  suppression persistante après rechargement et conservation du livre et des voix.
- Builds serveur et GitHub Pages réussis ; 9 contrôles Pages sous le chemin
  du dépôt et 6 contrôles avec relais simulé réussis.
- Vérifications d’accessibilité axe, navigation au clavier, progression,
  file persistante, reprise, annulation et stockage existants conservés.

## Limites

La vitesse réelle dépend du téléphone, de sa température et du texte. Les
mesures PC ne garantissent pas un démarrage instantané ou l’absence de pauses
sur tous les appareils. La préparation d’un livre entier conserve son intérêt.
L’application doit rester ouverte pour générer ; le changement de moteur ne
rend pas possible une conversion continue avec le navigateur fermé.

Les tests automatiques de signal et de transcription ne constituent pas une
évaluation humaine du naturel de la voix. Les accents, noms propres, nombres,
dialogues et sessions longues doivent aussi être appréciés à l’écoute.

Les données de contrôle de cette session sont dans
`.cache/piper-integration-check/` : fichiers vérifiés, textes d’essai, scripts
navigateur, WAV et résultats JSON. Ces modèles et enregistrements ne sont pas
versionnés. Le worker contrôlé a pour SHA-256
`73d489d11c919cdefc9f3cab5449c3de85bd92215e91509c6e37c6df52d59809`.
