# Écouter ses livres avec une voix locale

Le quatrième mode, **Écouter**, est facultatif. Il prépare la voix directement dans le navigateur, sans compte, abonnement, clé API ni envoi du texte du livre à un service vocal. Les trois modes de lecture existants restent disponibles.

## Première écoute

1. Ouvrir un livre et choisir **Écouter**.
2. Vérifier la langue du texte : la langue renseignée dans le livre est présélectionnée. Elle peut être corrigée si ses métadonnées sont inexactes.
3. Choisir la voix proposée, puis **Télécharger et écouter**. L’ouverture du dialogue ne télécharge rien automatiquement.
4. Suivre le téléchargement, puis la préparation du passage actuel. L’écoute démarre lorsque le son est prêt. Si le navigateur bloque le démarrage automatique, utiliser le bouton de lecture.

Le premier téléchargement représente environ **117 Mo**. Le modèle principal et les composants communs sont réutilisés lorsqu’on ajoute une voix. La taille réellement manquante est affichée avant chaque téléchargement ; elle dépend des fichiers déjà présents.

La sélection volontairement courte comprend Siwis en français, Heart en anglais, Dora en espagnol, Sara en italien et Dora en portugais brésilien. Il n’y a pas de voix allemande dans ce modèle. FastReader ne remplace pas automatiquement une langue sans voix par une autre langue.

## Connexion et stockage

Une connexion est nécessaire pour télécharger une voix manquante. Le bouton reste indisponible hors connexion, mais une voix déjà téléchargée peut être choisie et utilisée. Pour une écoute entièrement hors ligne, l’application, le livre et la voix doivent tous être disponibles sur cet appareil.

Le téléchargement peut être annulé. Les fichiers terminés sont conservés ; un fichier interrompu doit être retéléchargé. Une erreur de réseau ou un manque de place donne une explication et permet de réessayer. Une vérification de l’intégrité des fichiers précède leur mise à disposition.

**Retirer cette voix** libère ses fichiers devenus inutiles en conservant ceux requis par d’autres voix et en gardant les livres. Les téléchargements vocaux ne font pas partie des sauvegardes ZIP de la bibliothèque. Effacer les données du navigateur ou changer d’appareil impose de retélécharger les voix. Le navigateur peut aussi récupérer de l’espace lorsque le stockage manque.

## Pendant l’écoute

Lorsqu’une voix installée est sélectionnée, FastReader prépare silencieusement le début pendant que le choix reste ouvert. **Lancer l’écoute** réutilise ce travail : il ne recharge pas le moteur et ne recalcule pas la première phrase. Aucun son ne démarre avant ce clic. Fermer le choix, changer de voix ou mettre en pause annule la préparation silencieuse. Cette anticipation ne prend pas la place d’un livre déjà en cours de préparation dans la file.

Pendant l’attente, le lecteur affiche l’étape réelle — chargement de la voix, analyse du texte ou génération — puis le nombre de phrases et la durée d’audio prêts. Le chargement reste indéterminé lorsque le moteur ne fournit pas de progression mesurable ; le compteur ne représente pas un faux pourcentage de calcul. L’écoute démarre dès que la première phrase entière est prête, sans attendre les suivantes.

Le son est préparé par phrases complètes, avec plusieurs phrases en avance quand l’appareil le permet. Le tampon vise environ 30 secondes à venir, en plus de la phrase en cours, et reste limité à six phrases au total et 8 Mio ; une phrase courante particulièrement longue peut dépasser seule ce budget. Le découpage automatique tous les 180 caractères a été supprimé : si le moteur doit traiter une longue phrase en plusieurs fragments, ceux-ci sont assemblés avant de lancer son écoute. Une phrase plus longue peut donc demander davantage de préparation avant de commencer. Les anciens audios découpés restent lisibles : leurs fragments sont regroupés avant lecture sans effacer ni régénérer les enregistrements. La position de lecture suit le passage en cours. Pause, retour et passage suivant permettent de garder le fil ; la vitesse d’écoute est distincte de la cadence du mode Mot à mot.

Gardez FastReader ouvert pendant l’écoute. La lecture se met en pause lorsque l’application ou l’onglet passe en arrière-plan, notamment au verrouillage de l’écran.

Le réglage **Garder l’écran allumé pendant la lecture** peut éviter la mise en veille pendant la préparation ou l’écoute, lorsque le navigateur l’autorise. Il ne permet pas de poursuivre l’écoute après avoir quitté l’application.

La qualité et la rapidité varient selon la langue, le texte et l’appareil. Une attente initiale ou une interruption entre passages est possible. L’application ne promet pas une synthèse instantanée ni un alignement audio mot à mot.

## Préparer un livre pour l’écouter ensuite

Dans le choix de voix, **Préparer le livre** ajoute le livre à une file locale. Si la voix manque, **Télécharger et préparer le livre** permet d’abord de la récupérer avec le même suivi de téléchargement. Cette action ne lance pas l’écoute.

Dans **Ma bibliothèque**, le bouton **Préparer l’audio** de chaque livre ouvre le choix de voix. Après l’ajout, **Ajouter d’autres livres** ramène à la bibliothèque sans interrompre la préparation : vous pouvez ajouter le suivant. Fermer le panneau permet aussi de continuer à lire ou à découvrir des livres.

Le panneau **Préparations audio**, accessible via **Voir la file audio** dans la bibliothèque ou le bouton audio de l’application, affiche le pourcentage préparé, les passages et chapitres terminés, ainsi que la place occupée. Les livres sont préparés l’un après l’autre ; une écoute qui nécessite de générer la voix met la file en attente. Vous pouvez continuer à lire ou explorer votre bibliothèque pendant la préparation.

Recliquer sur **Écouter** dans un livre déjà préparé ou en préparation ouvre sa ligne dans la file, avec son état actuel, sans lancer une autre conversion. Cela fonctionne aussi après un rechargement. **Préparer avec une autre voix** ouvre volontairement le choix de voix ; la préparation existante reste conservée.

**Mettre en pause** conserve les passages terminés. **Reprendre** continue la préparation. **Annuler la préparation** supprime le travail et l’audio déjà préparé pour ce livre. Le livre reste dans la bibliothèque.

Gardez FastReader ouvert : la préparation se met en pause en arrière-plan et reprend au retour dans l’application. Après une fermeture ou un rechargement, les préparations inachevées sont conservées en pause ; utilisez **Reprendre**. La PWA ne promet pas de continuer une longue conversion lorsque le navigateur est fermé ou l’écran verrouillé.

**Écouter le début** apparaît dès que les premiers passages sont prêts, même si le reste du livre est encore en préparation. L’écoute et la préparation continuent ensemble ; sur un appareil compatible, deux phrases du même livre peuvent être générées en parallèle puis enregistrées dans l’ordre de lecture. Les livres de la file restent traités l’un après l’autre. Si l’écoute rattrape la préparation, le lecteur affiche une attente et reprend lorsque la suite est prête, y compris au changement de chapitre. **Pause** arrête cette reprise automatique. Si la préparation est en pause ou interrompue, le lecteur le précise et permet de rouvrir la file pour la reprendre.

**Écouter le début** démarre explicitement au début du livre ; une fois le livre entièrement préparé, **Lancer l’écoute** reprend à la position enregistrée. Annuler une préparation en cours d’écoute arrête aussi cet audio.

Un livre **Prêt à écouter** propose **Lancer l’écoute**. Son audio est déjà conservé sur l’appareil : aucune nouvelle génération n’est nécessaire entre les passages, et les fichiers du modèle vocal ne sont plus nécessaires pour écouter cet audio. La connexion n’est requise que pour les téléchargements manquants. Le livre ne démarre jamais tout seul lorsque sa préparation se termine.

La préparation complète prend davantage de place que le modèle vocal seul. Une estimation apparaît avant le lancement ; la taille réellement enregistrée est visible pendant le traitement. En cas de stockage insuffisant, libérez de la place puis reprenez. **Supprimer l’audio** conserve l’EPUB et ses repères. Les audios préparés ne sont pas inclus dans la sauvegarde ZIP ; supprimer les données locales du navigateur peut les effacer.

## Accélérer la préparation

L’accélération est automatique : deux moteurs peuvent préparer les phrases en parallèle lorsque le navigateur indique au moins 8 Gio de mémoire et quatre processeurs logiques sur ordinateur, ou huit sur mobile. Si la mémoire est inconnue ou inférieure, un seul moteur est utilisé. Sur un hébergement correctement isolé, un modèle peut utiliser deux ou quatre threads à la place ; GitHub Pages utilise le chemin portable ou parallèle. Aucun nouveau modèle n’est nécessaire. Si le second moteur échoue, sa phrase est reprise intégralement sur le premier.

Le [rapport de performance](VOICE-PERFORMANCE.md) contient les mesures sur le moteur intégré. L’anticipation réduit l’attente au clic et le parallèle augmente le débit, mais un premier passage non préparé demande toujours un calcul. Ces améliorations ne promettent pas une génération plus rapide que la lecture sur tous les appareils : préparer le livre entièrement reste utile pour une écoute sans attente de conversion.

## Vérifications et limites

Le moteur intégré a généré les cinq langues proposées sur Chromium et du français sur Firefox et WebKit, à partir des fichiers conservés localement, sans réseau disponible pour la synthèse. Le [rapport de vérification](VOICE-VERIFICATION.md) détaille les méthodes, les mesures et les limites de ces essais, distincts du prototype préalable.

L’interface a été vérifiée sur six langues, trois thèmes et deux formats d’écran. Les tests couvrent le choix de langue, le téléchargement explicite, la progression, l’annulation, la reprise, le retrait, le stockage insuffisant et le mode hors ligne. Ces résultats ne constituent pas une mesure de fluidité, de batterie ou de mémoire sur de vrais iPhone et Android ; ces essais physiques restent à réaliser.

La qualité sonore n’a pas encore été évaluée par une écoute humaine. Pour juger le naturel avant de généraliser l’écoute, comparer les voix avec de la narration, des dialogues, des noms propres, des nombres et de longs chapitres. Le modèle utilisé est [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), et la sélection se limite aux langues dont les voix sont disponibles.
