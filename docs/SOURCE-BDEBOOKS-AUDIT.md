# BDEbooks : intégration non activée

Vérification du 12 septembre 2026 sur le [catalogue anglais demandé](https://bdebooks.com/en/ebooks/).

La requête HTTP publique du relais potentiel a reçu un refus de l’origine : HTTP 403 accompagné de `cf-mitigated: challenge`. Le document renvoyé est une page Cloudflare intitulée « Just a moment… », pas le catalogue de livres. La vérification s’est arrêtée à cette étape ; aucune intégration de recherche ou de téléchargement direct n’est activée.

## Éléments observés

| Élément | Valeur capturée |
| --- | --- |
| Date de la réponse | 12 septembre 2026, 19:33:42 UTC |
| URL demandée | `https://bdebooks.com/en/ebooks/` |
| Statut | `HTTP/2 403` |
| Protection annoncée | `cf-mitigated: challenge` |
| Type de réponse | `text/html; charset=UTF-8` |
| Taille | 5 348 octets |
| Titre HTML | `Just a moment...` |
| Serveur annoncé | `cloudflare` |

Les captures locales utilisées pour ce constat sont `/tmp/fastreader-bdebooks-headers.txt` et `/tmp/fastreader-bdebooks-ebooks.html`. Ces fichiers temporaires ne sont pas nécessaires au fonctionnement de FastReader et ne sont pas inclus dans son dépôt.

Un outil de consultation avait pu afficher du texte public du catalogue. Cela ne prouve pas qu’un relais FastReader peut effectuer la recherche, obtenir les couvertures et télécharger un EPUB. Aucun fichier BDEbooks n’a été validé jusqu’à son ZIP, son OPF et son contenu lisible ; aucune capacité de lecture directe n’est donc annoncée.

## Suite possible

Aucun changement d’identité HTTP, transfert de cookie de protection, autre client ou recherche d’endpoint caché n’a été employé pour récupérer le contenu refusé. Il faudrait un accès distinct officiellement autorisé, par exemple une API ou un flux destiné à l’intégration, ou un accord de la source, pour reprendre cet essai. Aucune voie de ce type n’a été établie lors de cette vérification.

Le refus constaté ne démontre ni l’absence d’EPUB sur le site, ni l’impossibilité de l’utiliser manuellement. Il empêche simplement de garantir le parcours attendu dans FastReader : recherche, clic « Lire », import local et ouverture immédiate. Le site n’est pas présenté comme une source active pour éviter ce faux engagement.
