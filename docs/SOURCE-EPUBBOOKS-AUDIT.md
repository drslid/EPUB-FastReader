# epubBooks : recherche et lecture directe

Vérification du 12 septembre 2026. Source intégrée sous l’identifiant `epubbooks`, avec un relais pour les recherches et les EPUB. Le parcours public a été testé réellement, sans compte ni contournement de connexion.

## Résultat vérifié

La [fiche publique de Frankenstein](https://www.epubbooks.com/book/22-frankenstein) propose un EPUB. Depuis FastReader, une recherche, un clic sur le livre, le téléchargement puis l’import ont donné :

| Vérification | Résultat réel |
| --- | --- |
| Recherche `frankenstein` | Trois livres : *Mathilda*, *The Last Man*, *Frankenstein* ; la biographie de Mary Shelley est exclue des résultats de livres |
| Archive reçue | 270 697 octets, ZIP EPUB valide, archive originale conservée |
| Import FastReader | *Frankenstein*, Mary Wollstonecraft Shelley, 31 chapitres, 75 253 mots |
| Stockage | Livre et couverture choisie enregistrés dans IndexedDB |
| Rechargement | Lecture retrouvée avec le même livre |
| Couverture officielle récupérée pour le stockage local | JPEG de 73 225 octets |

Les essais du relais ont aussi été exécutés directement avec Node Fetch. Ils sont distincts des tests automatiques utilisant des réponses réseau contrôlées. Une édition réussie ne garantit pas la compatibilité de tout le catalogue.

## Recherche et périmètre

La [recherche officielle](https://www.epubbooks.com/search?q=frankenstein) utilise `GET /search?q=...`. Elle porte sur les mots-clés, titres, auteurs et descriptions ; ce n’est pas une recherche strictement limitée au titre. L’interface publique présente des meilleurs résultats, sans pagination exploitable confirmée. L’adapter ne fabrique donc pas de pages suivantes et indique un décompte approximatif pour les résultats retournés.

Une requête sans correspondance présente un message d’absence suivi de recommandations. Le plugin détecte ce cas et retourne zéro résultat : ces recommandations ne doivent pas devenir de fausses correspondances. Les biographies d’auteurs sont également filtrées.

La recherche distante ne part que pour une requête non vide et une langue compatible. Le site présente sa collection comme anglophone dans sa [présentation](https://www.epubbooks.com/about). La recherche passe par le relais car les réponses HTML observées n’autorisent pas CORS depuis GitHub Pages.

## Téléchargement anonyme

Le [script officiel de téléchargement](https://www.epubbooks.com/assets/download.js) utilise le processus suivant :

1. Lire la fiche de l’édition et sélectionner uniquement l’offre EPUB.
2. Faire `POST /downloads` avec l’identifiant numérique de cette offre.
3. Recevoir un identifiant temporaire de téléchargement et un cookie anonyme nommé `download`.
4. Récupérer `GET /downloads/{identifiant}/file` avec ce seul cookie.

Le site affiche une validité de 60 secondes pour ce lien. L’essai sans conservation du cookie a renvoyé HTTP 404 ; le parcours complet, dans un navigateur puis dans le relais, a bien renvoyé l’EPUB. Il n’a fallu ni compte utilisateur, ni mot de passe, ni cookie provenant de l’utilisateur FastReader.

Le cookie reste dans la portée de cette opération serveur, n’est envoyé qu’à epubBooks et n’est jamais transmis au navigateur FastReader. Le relais ne stocke pas les archives téléchargées. Il refuse les identifiants détournés, les redirections, les jetons de format inattendu, les pages HTML à la place d’un EPUB et les réponses HTTP 401/403/429. Ces refus n’entraînent aucun essai sur un miroir ou un autre endpoint.

Le slug est nécessaire : `/book/22` a renvoyé 404, tandis que `/book/22-frankenstein` fonctionne. Les identifiants FastReader conservent donc ce slug, avec une identité canonique numérique pour l’édition.

## Couverture et droits

Pour le livre testé, l’image du catalogue est une couverture illustrée sombre, tandis que l’EPUB contient une couverture éditeur beige et rouge. Utiliser directement la couverture embarquée changerait l’apparence du livre dans la bibliothèque.

L’endpoint de couverture résout l’image déclarée dans la fiche officielle, vérifie sa signature JPEG/PNG et la renvoie uniquement au moment de l’import. FastReader conserve cette image localement, ainsi que l’URL de la miniature sélectionnée. Une indisponibilité de l’image n’empêche pas la lecture de l’EPUB.

Les [conditions d’epubBooks](https://www.epubbooks.com/terms) demandent de vérifier les droits applicables dans son pays. L’EPUB testé comporte une mention de copyright de l’éditeur pour son édition ; l’adapter conserve les crédits et autorise l’export de l’original. Il ne déclare pas automatiquement un droit de produire et redistribuer une édition modifiée en Focus ou Classique.

## Contrat technique

- Source : `src/sources/epubbooks.js`, identifiant `epubbooks`.
- Recherche : `GET /api/sources/epubbooks/search?query=frankenstein&page=1`.
- EPUB : `GET /api/books/epubbooks/22-frankenstein.epub`.
- Couverture facultative : `GET /api/sources/epubbooks/cover/22-frankenstein.jpg`.
- Relais : `createEpubbooksHandler` et `createEpubbooksMiddleware`, dans `server/epubbooks-source.js`.
- Couverture côté client : `downloadEpubbooksCover(book, { signal })`, renvoie un Blob JPEG/PNG.

Limites du handler : 35 secondes, 2 Mio pour une réponse catalogue, 30 Mio par EPUB, deux recherches simultanées et un téléchargement EPUB simultané. Les couvertures ont leurs propres deux créneaux, une limite de 1 Mio et un délai de 4 secondes côté serveur, 4,5 secondes côté navigateur.

Le cache de recherche dure cinq minutes et est borné à la fois par le nombre d’entrées et leur taille cumulée. Les options `cacheMaxBytes` et `maxCachedSearches` permettent de réduire les maxima par défaut de 4 Mio et quatre entrées ; zéro désactive le cache. Le Worker de production peut appliquer des limites plus strictes. Une réponse dépassant le budget total reste lisible mais n’est pas conservée dans le cache.

## Tests

`tests/epubbooks.test.js` couvre recherche, faux résultats recommandés, provenance, cookie anonyme, refus et redirections, conservation de l’archive, cache borné, annulation, signatures et taille des images.

`tests/e2e/epubbooks.spec.js` vérifie le parcours de lecture, la couverture locale et la reprise sans second téléchargement, l’échec facultatif d’une couverture, l’échec EPUB sans faux livre enregistré et l’absence de fausses correspondances. Les requêtes de ces tests sont simulées ; aucune charge automatique n’est envoyée à epubBooks en CI.
