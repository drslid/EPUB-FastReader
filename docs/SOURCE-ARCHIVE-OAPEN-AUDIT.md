# Internet Archive et OAPEN : vérification de recherche et d’accès

Contrôles ciblés du 12 septembre 2026, sans activation dans FastReader. L’objectif était une recherche utilisable puis l’ouverture réelle d’un EPUB depuis GitHub Pages, sans compte ni relais. **Aucune de ces deux pistes n’a démontré ce parcours complet.**

## Internet Archive

L’API de recherche avancée répond à la requête suivante, limitée à trois résultats :

`mediatype:texts AND format:EPUB AND title:"Pride and Prejudice" AND NOT access-restricted-item:true`

L’API retourne 96 notices correspondantes ; ce chiffre n’est ni un nombre de livres uniques, ni une validation de leurs droits. La notice `PrideAndPrejudiceJaneAusten` annonce un fichier original EPUB, en anglais, et une Public Domain Mark. Les [métadonnées publiques de cette édition](https://archive.org/metadata/PrideAndPrejudiceJaneAusten) précisent qu’il s’agit d’une copie dérivée de Gutenberg 1342. Cet exemple vérifie le circuit technique ; il n’apporte donc pas une nouvelle œuvre absente de Gutenberg.

Le lien officiel d’acquisition, issu des métadonnées, est :

`https://archive.org/download/PrideAndPrejudiceJaneAusten/Pride%20and%20Prejudice%20-%20Jane%20Austen.epub`

Une requête HTTP normale, sans identifiants, a suivi la redirection fournie par Internet Archive vers `dn760104.eu.archive.org` : **HTTP 200, `application/epub+zip`, 400 607 octets**, sans `Access-Control-Allow-Origin` dans la réponse finale. Aucun autre hôte ou paramètre de contournement n’a été essayé.

Le fichier a été ouvert avec le vrai `importEpub` de FastReader, dans JSDOM : titre et auteur corrects, langue `en`, couverture présente, 15 sections. Le découpage regroupe plusieurs chapitres littéraires dans une section, et la première section ne contient aucun mot : ce n’est pas un exemple de sommaire idéal. Son SHA-256 est `f1cdef5429993ebeca95fb791af89fcda861f685455d343d1e1a06903e9a2a29`.

Un test Chromium, depuis l’origine `https://drslid.github.io`, a ensuite confirmé :

| Requête réelle | Résultat navigateur |
| --- | --- |
| Recherche avancée des EPUB publics | HTTP 200, réponse CORS lisible |
| Métadonnées de l’édition | HTTP 200, réponse CORS lisible |
| Acquisition EPUB ci-dessus | `TypeError: Failed to fetch`, téléchargement JavaScript refusé |

La page de test vide était interceptée par Playwright ; les réponses Internet Archive étaient réelles. Ce test démontre la différence entre recherche et accès au fichier. Une notice consultable ou un fichier téléchargeable par navigation ne suffisent pas pour l’import automatique dans IndexedDB.

La présence d’un fichier public ne vaut pas autorisation générale de réhéberger tous les fichiers d’Internet Archive. Chaque édition et ses contributions doivent avoir des droits établis ; exclure prêts, fichiers restreints et licences incompatibles. Aucun pack officiel à droits homogènes, taille raisonnable et apport éditorial distinct n’a été établi dans cet audit. La [documentation officielle destinée aux développeurs](https://archivesupport.zendesk.com/hc/en-us/articles/360001495812-Developer-Resources) décrit les interfaces disponibles, mais ne constitue pas une licence générale des contenus.

**Décision :** ne pas présenter Internet Archive comme une solution directe fonctionnelle sur Pages. Un catalogue sélectionné avec fichiers redistribuables hébergés localement ou un relais nécessiterait un travail et un périmètre supplémentaires.

## OAPEN

La [documentation officielle REST](https://www.oapen.org/article/8185269-search-using-a-rest-api) permet une recherche avec métadonnées et fichiers associés. Une vraie requête `dc.title:water`, limitée à trois notices, avec `expand=metadata,bitstreams` a répondu HTTP 200. Les fichiers de livres des trois résultats examinés étaient des PDF ; aucun EPUB n’a été contrôlé pour cette source.

L’API testée ne renvoie pas `Access-Control-Allow-Origin`. Chromium a confirmé que cette recherche est refusée depuis l’origine Pages. Le [régime CC0 annoncé pour les flux de métadonnées](https://www.oapen.org/article/metadata) permet d’envisager un index local ; il ne détermine pas la licence de chaque livre et ne démontre pas qu’un EPUB serait directement récupérable.

**Décision :** ne pas retenir OAPEN sur ces seules preuves pour le parcours demandé. L’existence d’une API documentée et de livres en accès ouvert ne suffit pas à prouver la présence et l’import direct d’EPUB adaptés au lecteur.
