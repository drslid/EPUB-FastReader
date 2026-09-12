# Loyal Books — audit et intégration

Vérifications effectuées le 12 septembre 2026. L’intégration recherche dans une **sélection locale et datée**, puis résout l’EPUB public de l’édition demandée. Elle ne prétend pas interroger tout le catalogue de Loyal Books.

## Preuves d’accès et périmètre

L’[accueil](https://www.loyalbooks.com/), les [listes par langue](https://www.loyalbooks.com/language-menu) et les fiches sont accessibles par navigation ordinaire. Une recherche « Candide » effectuée dans Chromium aboutit à `/search?q=Candide`, puis à des résultats injectés par Google Programmable Search. Ces résultats mélangent fiches de livres, flux audio et pages de langues. Aucun endpoint interne Google, aucune clé du fournisseur et aucune page `/search/` ne sont utilisés par le plugin ou le collecteur.

Le fichier [robots.txt](https://www.loyalbooks.com/robots.txt) publie `Content-Signal: search=yes`, indique un délai de collecte de 60 secondes et interdit `/search/`. Son [sitemap](https://www.loyalbooks.com/sitemap.xml), observé à 6 604 305 octets, contient 35 771 adresses de livres. Certaines entrées proposent une image avec titre/auteur, mais le sitemap ne garantit ni langue ni disponibilité EPUB. Il ne constitue donc pas à lui seul un catalogue de lecture directe.

Le collecteur utilise exclusivement les listes publiques `/language/{Language}?type=ebook&results=100`, avec pagination annoncée par la source. Par exemple, la [liste française EPUB](https://www.loyalbooks.com/language/French?type=ebook&results=100) distingue explicitement les EPUB des livres audio. Les titres et auteurs sont conservés intégralement ; les scripts, publicités, descriptions commerciales et avis ne sont pas copiés.

Snapshot initial : `public/catalog/loyalbooks.json`, **499 notices**, **117 080 octets**, **207 couvertures fournies**, collecte achevée à `2026-09-12T19:48:30.100Z`.

| Langue | Notices indexées | Total annoncé dans la liste EPUB | Pages collectées |
| --- | ---: | ---: | ---: |
| Français | 100 | 1 434 | 1 |
| Espagnol | 100 | 288 | 1 |
| Italien | 100 | 272 | 1 |
| Allemand | 99 | 701 | 1 |
| Portugais | 100 | 477 | 1 |

Ces chiffres décrivent les résultats indexés et les totaux annoncés par les listes, pas des archives téléchargées individuellement. Le lien EPUB de chaque édition est vérifié au moment de l’ouverture ; une édition supprimée ou devenue indisponible produit une erreur explicite. Une couverture absente reste absente dans les données : aucune image de remplacement n’est attribuée au fournisseur.

L’anglais est explicitement exclu de cette première sélection. Sa liste publique renvoie HTTP 200 avec un total de 26 108 EPUB, mais aucune fiche exploitable. Ajouter `page=1` déclenche en outre une redirection qui retire les paramètres. Le classement Top 100 mélange formats et langues et ne fournit pas un remplacement fiable. Le collecteur omet `page=1` et ne publie jamais une liste vide comme une collecte réussie.

## EPUB réellement vérifié

La [fiche d’Emma de Jane Austen](https://www.loyalbooks.com/book/emma-by-jane-austen) annonce un EPUB à l’adresse HTTPS `/download/epub/Emma-by-Jane-Austen.epub`. Ce fichier a été obtenu par accès anonyme ordinaire, sans cookie utilisateur, authentification ni redirection supplémentaire :

- HTTP 200, `Content-Type: application/epub+zip`, 365 971 octets ;
- archive ZIP lisible, entrée `mimetype` correcte et `META-INF/container.xml` présent ;
- titre Emma, auteur Jane Austen, langue `en`, 18 entrées dans l’ordre de lecture ;
- identifiant Gutenberg 158 et droits déclarés « Public domain in the USA. » ;
- aucune couverture embarquée déclarée dans le manifeste EPUB.

Cette preuve valide un téléchargement réel, mais Emma n’est pas ajouté artificiellement à l’index anglais vide. Le fichier temporaire de cette vérification n’était plus présent lors de la reprise du runtime ; les résultats ci-dessus sont conservés dans les sorties de l’audit. Aucun second téléchargement de ce livre n’a été effectué pour les tests. Les tests automatisés emploient des EPUB locaux du projet ou des fixtures générées, sans réseau fournisseur.

La réponse EPUB observée n’annonçait pas d’en-tête `Access-Control-Allow-Origin`. Le plugin passe par le relais configuré pour fournir à GitHub Pages une réponse lisible par JavaScript. Une simple navigation réussie vers un téléchargement ne prouve pas un accès CORS utilisable depuis FastReader.

La [présentation de Loyal Books](https://www.loyalbooks.com/about) explique que ses textes proviennent notamment de Project Gutenberg et ses enregistrements de LibriVox. Cette source enrichit la sélection et sa présentation ; elle ne garantit pas des œuvres distinctes de celles des autres catalogues. Chaque résultat affiche Loyal Books et le rappel sur les droits applicables à l’édition et au pays.

## Contrat du plugin et du relais

`src/sources/loyalbooks.js` exporte le plugin `loyalbooks`, ainsi que `loadLoyalbooksCatalog`, `parseLoyalbooksCatalog`, `loyalbooksAvailable` et `downloadLoyalbooksCover`.

La recherche charge le snapshot depuis l’origine de FastReader, filtre titre/auteur et langue, puis renvoie des pages de 24 notices. Elle expose `catalogCoverage: { kind, updatedAt, languages }`. Aucun terme saisi n’est envoyé à Loyal Books ou Google. Une langue non indexée renvoie simplement zéro résultat dans cette sélection.

Identité : `loyalbooks-{slug}` ; identité canonique : `loyalbooks:{slug}`. Les slugs Unicode sont validés, puis encodés comme un seul segment d’URL. Les titres longs ne sont pas tronqués.

`server/loyalbooks-source.js` exporte `createLoyalbooksHandler`, `createLoyalbooksMiddleware`, `parseLoyalbooksDetail` et `LOYALBOOKS_LIMITS`.

| Route GET | Comportement |
| --- | --- |
| `/api/books/loyalbooks/{slug}.epub` | Consulte la fiche de l’édition, sélectionne son lien EPUB annoncé et valide l’archive obtenue. |
| `/api/sources/loyalbooks/cover/{slug}.jpg` | Consulte la fiche puis récupère son image de couverture JPEG ou PNG. |

Les couvertures de catalogue sont indépendantes de la couverture éventuellement embarquée dans l’EPUB. Le téléchargement optionnel de l’image permet de conserver sa présentation localement. Son échec n’empêche pas l’import du livre.

Protections du relais :

- seule origine amont autorisée : `https://www.loyalbooks.com` ; aucun miroir, URL arbitraire, cookie utilisateur ou compte ;
- fichiers annoncés sous `/download/epub/` et images sous `/image/detail/`, avec noms de fichiers validés ; redirections refusées ;
- contrôle strict de l’origine appelante et des prérequêtes CORS ; GET uniquement pour les données ;
- délais maximaux de 35 secondes pour un EPUB et 4 secondes pour une couverture ;
- réponse de fiche limitée à 1 Mio, EPUB à 30 Mio et couverture à 1 Mio, y compris pour les flux sans `Content-Length` ;
- signature ZIP, `mimetype` et conteneur EPUB contrôlés ; taille compressée du petit membre `mimetype` bornée avant décompression, même si son champ de taille décompressée est falsifié ;
- signature JPEG/PNG contrôlée, SVG refusé ;
- un téléchargement EPUB et deux couvertures simultanés au maximum ; annulation propagée et places libérées ;
- HTTP 401, 403 et 429 interrompent l’accès et déclenchent une temporisation ; aucun changement d’adresse ni nouvelle identité ;
- seul cache serveur : 16 petits descripteurs contenant deux URL validées, pendant cinq minutes. Aucun HTML, cookie, EPUB ou image n’y est conservé.

Le délai de 60 secondes concerne le collecteur de métadonnées. La récupération d’une édition suit uniquement l’action explicite du lecteur et les liens de téléchargement du site ; elle ne lance aucune collecte de catalogue.

## Actualisation de la sélection

```sh
node scripts/update-loyalbooks.mjs
node scripts/update-loyalbooks.mjs --pages-per-language 2
node scripts/update-loyalbooks.mjs --refresh --pages-per-language 1
```

Les langues par défaut sont `fr,es,it,de,pt`. `--languages` permet une sélection explicite ; les autres langues figurent dans `excludedLanguages`. L’anglais pourra être ajouté lorsque sa liste publique EPUB fournira effectivement des fiches.

Le checkpoint `.cache/loyalbooks-index.json` mémorise les pages validées et la prochaine date de requête autorisée. Cette date est persistée **avant** la requête. Une interruption, un refus ou un redémarrage ne réinitialise pas le délai. Un fichier de verrouillage interdit deux collecteurs concurrents ; après un arrêt forcé, vérifier que le processus précédent est terminé avant de retirer un verrou abandonné.

Une exécution normale reprend les pages déjà collectées. `--refresh` ouvre une nouvelle collecte sans réinitialiser le délai ; une reprise de cette collecte conserve ses pages validées. Le snapshot public est remplacé atomiquement uniquement après validation de toutes les pages demandées. Les réponses refusées, les listes vides, les formats modifiés ou un résultat JSON supérieur à **2 Mio** préservent le snapshot existant. Au-delà de cette taille, réduire le nombre de pages ou faire évoluer le format en fichiers séparés avant publication.

Le collecteur ne télécharge aucun EPUB ni aucune image. Il n’exécute pas les scripts du site et ne sollicite pas sa recherche Google. Une extension complète de la sélection prendrait plusieurs heures au délai annoncé : les volumes doivent être examinés avant de lancer davantage de pages.

## Validation reproductible

`tests/loyalbooks.test.js` couvre recherche locale, pagination, provenance, couverture datée de l’index, titres/identifiants Unicode, configuration Pages, téléchargement, CORS, chemins interdits, formats incorrects, taille, quota/refus, annulation et couverture optionnelle. Il comprend un ZIP forgé dont le membre `mimetype` dépasse quatre Mio tout en annonçant une petite taille décompressée.

`tests/loyalbooks-generator.test.js` couvre extraction des listes EPUB, distinction audio, délai de 60 secondes, checkpoint, reprise, actualisation explicite, verrouillage concurrent, conservation du snapshot sur erreur et refus d’un fichier supérieur à 2 Mio.

`tests/e2e/loyalbooks.spec.js` couvre recherche locale, couverture visible, clic Lire, ajout en IndexedDB, mode mot à mot, couverture locale après rechargement, réouverture sans second téléchargement et erreurs indépendantes d’EPUB/couverture. Les routes fournisseur sont simulées ; l’exécution groupée navigateur est assurée par la validation du projet.
