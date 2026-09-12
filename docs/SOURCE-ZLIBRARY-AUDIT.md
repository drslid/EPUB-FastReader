# Z-Library.sk : accès vérifié, intégration non validée

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
