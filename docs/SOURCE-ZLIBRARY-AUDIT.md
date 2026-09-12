# Z-Library.sk : accès vérifié, intégration non validée

**Source retirée de FastReader à la demande de l’utilisateur.** Ce document conserve uniquement l’historique de l’évaluation ; il ne décrit pas une source active.

Vérification du 12 septembre 2026 sur le domaine demandé : [https://z-library.sk/](https://z-library.sk/). Aucun miroir, compte, login, challenge résolu ou changement d’identité n’a été utilisé.

| Essai réel | Résultat |
| --- | --- |
| Outil de navigation web | Le domaine n’a pas pu être ouvert par cet outil ; ce résultat seul ne démontre pas une panne du site |
| Requête HTTP ordinaire | HTTP 307 vers la même URL, cookie `__diamwall`, réponse de protection DiamWall |
| Navigation Chromium standard | HTTP 517, titre « Access Denied \| DiamWall » ; aucune interface de catalogue reçue |
| CORS sur la réponse HTTP initiale | Aucun en-tête d’autorisation observé |

La navigation réelle s’est arrêtée sur cette protection. Aucun endpoint de recherche, aucune fiche de livre, aucune couverture et aucun fichier EPUB n’a pu être validé sur ce domaine dans cet environnement. On ne peut donc pas annoncer une recherche fonctionnelle ou une ouverture directe dans FastReader.

Cette observation ne signifie pas que tous les utilisateurs, dans tous les pays ou réseaux, voient la même réponse. Elle ne permet pas non plus de déduire les conditions de compte ou d’accès aux téléchargements derrière la protection. Il faudrait un accès officiellement permis et réellement vérifiable avant d’implémenter un plugin opérationnel.

La source reste signalée comme indisponible pour l’intégration. Aucune réponse de démonstration n’est substituée au catalogue réel et aucun livre n’est présenté comme téléchargeable sans qu’un EPUB puisse être obtenu.

Preuve locale de la vérification : capture `/tmp/zlibrary-access-probe.png`, en-têtes `/tmp/zlibrary-headers.txt`. Ces fichiers temporaires ne contiennent aucun identifiant de compte utilisateur.

## Nouvelle tentative après la demande de correction

Le 12 septembre 2026, une nouvelle requête HTTPS puis une navigation Chromium indépendante reproduisent le problème : redirection HTTP 307 sur `https://z-library.sk/`, puis HTTP 517 et titre « Access Denied | DiamWall ». La page de refus est servie avant tout catalogue. Le navigateur a suivi les redirections normalement, sans manipulation de challenge ni réutilisation d’une session utilisateur.

Les preuves de cette seconde tentative sont conservées localement dans `/tmp/fastreader-zlibrary-recheck/` (`initial.headers`, `initial.html`, `browser.png`). Le résultat ne valide ni la recherche, ni les couvertures, ni le téléchargement d’un EPUB. Il ne permet pas de conclure que le domaine est inaccessible depuis le navigateur personnel de chaque lecteur.

### Pistes d’intégration examinées

- Le [moteur Z-Library de SearXNG](https://docs.searxng.org/dev/engines/online/zlibrary.html) sait décrire des recherches filtrées sur le format EPUB. Cela démontre l’existence d’un adaptateur de recherche, sans garantir l’accès actuel depuis FastReader ou l’obtention du fichier.
- La [documentation communautaire de l’EAPI](https://github.com/baroxyton/zlibrary-eapi-documentation) se présente explicitement comme non officielle. Elle décrit des identifiants de session, une connexion et des opérations de téléchargement. Ce n’est pas une documentation d’intégration publiée par Z-Library ; aucune session n’a été créée ou empruntée pour cet audit.
- Le [mainteneur de zlibrary-mcp](https://github.com/rookslog/zlibrary-mcp/blob/master/ISSUES.md) rapporte le même refus DiamWall sur `.sk`, ainsi que des restrictions dépendant du réseau pour son client EAPI. Ses observations sur d’autres domaines ne constituent pas une validation du parcours FastReader. Aucun client tiers ni mécanisme de contournement n’a été exécuté.
- [Open SLUM](https://open-slum.org/) signale les six adresses Z-Library qu’il surveille comme `PROTECTED` au moment de cette vérification. Son indicateur global vert inclut expressément les sites protégés : il ne prouve pas que la recherche automatisée ou les EPUB sont accessibles.
- L’annonce [« The Search Engine Tips » du 7 septembre 2026](https://lib-talk.io/viewtopic.php?t=282), publiée par Milly_B sur le forum relayé par le [compte Z-Library Official](https://mastodon.social/@Z_Lib_official), indique : « As you may have noticed, you're now required to pass through DiamWall before accessing our website. » Elle oriente vers le support en cas de difficulté. Cette annonce a été consultée durant la recherche ; une ouverture ultérieure par l’outil a été refusée, sans nouvelle tentative par une autre voie.

### Conclusion pour FastReader

Le refus constaté est une réponse du service distant, en amont du traitement des livres. Modifier uniquement le parseur HTML, les couvertures ou les en-têtes CORS du relais ne suffirait pas à le résoudre. Aucune correction fonctionnelle de l’accès n’est validée à ce stade ; le statut indisponible est maintenu.

La prochaine étape dépend d’un accès autorisé fourni par le service et testable de bout en bout : recherche EPUB, fiche et couverture, téléchargement réel, puis import et ouverture dans FastReader. L’accès éventuel depuis le navigateur habituel de l’utilisateur doit être distingué de celui du relais partagé. Aucun compte du lecteur ne doit être déduit, créé ou transmis au relais sur la base de cet audit.

## Retour utilisateur : accès anonyme, liens temporaires et quota

Le 12 septembre 2026, l’utilisateur confirme que certains EPUB se téléchargent sans compte depuis son navigateur. Il fournit deux liens de redirection sur `dln1.ncdn.ec`, puis rapporte un refus « Daily limit reached » indiquant plus de cinq téléchargements depuis son IP pendant les dernières 24 heures. Le message propose une connexion ou une inscription pour poursuivre. D’autres livres lui semblent demander une authentification ; ce dernier point n’a pas été vérifié indépendamment.

Ce retour corrige toute interprétation selon laquelle un compte serait systématiquement nécessaire. Il ne contredit pas le refus DiamWall observé dans l’environnement de test : accès au catalogue, délivrance d’un fichier et quota sont des étapes distinctes.

### Analyse sans téléchargement supplémentaire

Les deux liens contiennent notamment `filename`, `md5` et `expires`. En interprétant `expires` comme un horodatage Unix en secondes, les échéances annoncées sont respectivement le **12 septembre 2026 à 20:27:24 et 20:34:30, heure de Paris**. Cette structure suggère des liens signés temporaires ; la signification cryptographique des paramètres, la validité réelle et une éventuelle liaison à l’IP ou à la session n’ont pas été vérifiées.

Aucune requête, même `HEAD`, n’a été envoyée à ces liens après le signalement du quota. Aucun téléchargement n’a été tenté depuis une autre IP, via le relais ou un autre domaine. Les URL complètes, leurs paramètres de signature et l’IP personnelle de l’utilisateur ne sont pas recopiés dans le dépôt.

### Conséquences pour l’intégration

| Point | Conséquence |
| --- | --- |
| Téléchargement anonyme constaté par l’utilisateur | Ne pas imposer de compte FastReader ou présumer qu’un compte Z-Library est toujours nécessaire |
| Quota annoncé par IP sur les dernières 24 heures | Un relais partagé risque de mutualiser la limite entre lecteurs ; il ne doit pas servir à poursuivre un téléchargement après le refus côté utilisateur |
| Liens portant une expiration | Ne pas conserver ces adresses comme URL permanentes de catalogue ; il faudrait obtenir un lien frais par le parcours autorisé de la source |
| Ouverture d’un lien dans le navigateur | Ne valide pas la lecture du fichier par le JavaScript de FastReader : les autorisations CORS du serveur de téléchargement restent à vérifier |
| Catalogue inaccessible dans l’environnement de test | La recherche, l’identification des EPUB et la récupération des liens frais restent non validées |

La différence entre navigation et lecture d’une réponse par `fetch()` est décrite dans la [documentation CORS de MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS). Aucun en-tête CORS du CDN n’a été observé lors de cette analyse : on ne peut annoncer ni sa présence ni son absence.

Le seul parcours actuellement validé par les éléments disponibles reste le téléchargement autorisé sur le site source, puis l’import local du fichier dans FastReader. L’utilisateur peut déjà importer les fichiers qu’il a obtenus ; aucun nouveau téléchargement n’est nécessaire pour les lire. Le parcours automatique « recherche → EPUB → bibliothèque → lecture » n’est toujours pas validé pour cette source. Un futur essai doit attendre la levée de la restriction ou utiliser un accès distinct explicitement autorisé par le fournisseur, sans promettre de remise à zéro à minuit ni inventer un horaire de réouverture à partir du dernier message d’erreur.
