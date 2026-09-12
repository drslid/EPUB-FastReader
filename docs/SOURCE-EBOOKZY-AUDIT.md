# Ebookzy : recherche, EPUB et couverture

Vérification du 12 septembre 2026. Le parcours public d’Ebookzy permet une recherche anglophone et la lecture directe d’un EPUB depuis FastReader, au moyen du relais. Un téléchargement et un import réels ont été vérifiés, sans compte, cookie utilisateur, changement d’identité HTTP ni résolution de protection.

## Parcours réellement vérifié

| Étape | Résultat observé |
| --- | --- |
| [Recherche Shakespeare](https://ebookzy.com/?s=Shakespeare) | HTTP 200, 101 810 octets de HTML, 28 résultats avec titres, auteurs, couvertures et lien vers la page suivante |
| [Fiche de Macbeth](https://ebookzy.com/macbeth/) | HTTP 200 ; liens publics distincts EPUB et EPUB3 présents dans la fiche |
| [EPUB annoncé dans la fiche](https://ebookzy.com/free-ebooks/epub-macbeth-by-william-shakespeare.epub) | HTTP 200, `application/epub+zip`, 81 147 octets |
| Structure du fichier | ZIP, `mimetype` EPUB, `META-INF/container.xml`, `OEBPS/content.opf` et neuf éléments dans le spine |
| Import par le véritable parseur FastReader | *Macbeth*, William Shakespeare, anglais, neuf chapitres et 18 505 mots |
| [Couverture du catalogue](https://ebookzy.com/wp-content/uploads/2025/10/macbeth-by-william-shakespeare.png) | PNG de 368 632 octets, également obtenu par le handler du relais |

Cette preuve a utilisé `createEbookzyHandler` avec Fetch Node, puis `parseEbookzySearch` et `importEpub`. Elle vérifie davantage qu’un simple statut HTTP 200 : le contenu du livre est effectivement lisible par FastReader. Les mesures ci-dessus proviennent de cet essai réel ; les réponses contrôlées des tests automatiques ne sont pas présentées comme des téléchargements réels. Une édition vérifiée ne garantit pas la compatibilité du catalogue entier.

L’outil de consultation web a échoué sur certaines ouvertures directes, tandis que les requêtes HTTP publiques ordinaires ont renvoyé le contenu avec HTTP 200. Aucun refus de l’origine n’a été contourné. Le relais s’arrête si l’origine renvoie ensuite HTTP 401, 403 ou 429.

## Recherche et pagination

Le parcours public utilise `GET /?s=Shakespeare`, puis le lien annoncé `/page/2/?s=Shakespeare`. Le plugin ne demande une page suivante que si le HTML contient un lien « next » vers la même requête et le numéro suivant. Il borne la navigation à 100 pages et présente un nombre de résultats approximatif lorsque la liste est paginée.

Les résultats sont extraits des articles du contenu principal, pas des recommandations ou des éléments du pied de page. L’auteur provient du lien de catégorie `/author/…/` et non de la signature du rédacteur WordPress. Une recherche réelle sans correspondance a renvoyé la section `.no-results` : elle produit une liste vide.

Une requête vide, une langue autre que l’anglais ou « Toutes les langues », ou des paramètres invalides ne lancent pas de recherche distante. Les réponses HTML et EPUB observées n’annoncent pas d’autorisation CORS pour GitHub Pages ; le relais est donc nécessaire. Les recherches restent indépendantes des autres fournisseurs de FastReader.

## Fichier, couverture et droits

Le relais suit uniquement le lien EPUB explicitement publié dans la fiche, en privilégiant le lien EPUB lorsqu’EPUB et EPUB3 sont proposés. Il ne reconstruit pas une URL de fichier à partir du titre et n’utilise ni les liens PDF ni les liens marchands.

L’archive de *Macbeth* contient la mention « Public domain in the USA. », du contenu de Project Gutenberg et sa licence complète. La [présentation d’Ebookzy](https://ebookzy.com/about/) décrit une collection gratuite du domaine public. Ces indications ne constituent pas une garantie de droits pour chaque pays et chaque édition. FastReader affiche la provenance et le rappel régional, préserve les crédits et conserve l’archive originale. Les métadonnées éditoriales de la fiche, notamment sa date et son éditeur, ne sont pas utilisées pour attribuer des droits à l’EPUB : elles ne correspondent pas nécessairement à l’édition téléchargée.

Le bouton « Télécharger l’EPUB » reste disponible en Classique. Pour cette source, les indicateurs `canExportClassic: false` et `canExportFocus: false` empêchent la transformation de l’archive : le fichier original est restitué sans modification, avec ses mentions conservées. Cela ne limite pas le choix du mode de lecture dans FastReader.

La couverture du résultat est conservée au moment de l’import afin de garder la même présentation dans la bibliothèque et hors ligne. La fiche de *Macbeth* annonce le logo du site dans `og:image` ; le relais utilise donc son image de couverture `wp-post-image`, située dans les uploads datés. Il vérifie l’adresse, la taille et la signature PNG/JPEG/WebP. Un échec de couverture ne bloque pas l’import du livre.

## Contrat et limites du relais

- Source : `src/sources/ebookzy.js`, identifiant `ebookzy`, langue `en`.
- Recherche : `GET /api/sources/ebookzy/search?query=Shakespeare&page=1`.
- EPUB : `GET /api/books/ebookzy/macbeth.epub`.
- Couverture : `GET /api/sources/ebookzy/cover/macbeth.png` ; le type MIME correspond à la signature réelle.
- Serveur : `createEbookzyHandler` et `createEbookzyMiddleware`, dans `server/ebookzy-source.js`.
- Client : `downloadEbookzyCover(book, { signal })`, qui renvoie un Blob de couverture.

Les hôtes, chemins, slugs et paramètres sont limités explicitement. Les URL fournies par le navigateur ne deviennent jamais des URL arbitraires de téléchargement. Le relais rejette les redirections, n’envoie pas les cookies ou l’Authorization du lecteur et n’accepte que GET et les prévols CORS de lecture autorisés.

Les limites par défaut sont de 35 secondes et 2 Mio pour le catalogue, 30 Mio par EPUB, 4 secondes et 1 Mio pour une couverture. Deux recherches, un EPUB et une couverture peuvent être traités simultanément par le handler. Le cache conserve uniquement les recherches terminées, pendant cinq minutes, avec un maximum cumulé de 512 Kio et deux entrées ; aucune archive EPUB n’est mise en cache par ce fournisseur. Le Worker applique également son budget global de téléchargements.

Les corps de réponses sont bornés même sans `Content-Length`. Avant restitution, l’archive doit présenter la signature ZIP, le `mimetype` EPUB et son conteneur, avec des limites sur les entrées de contrôle. La validation complète du livre reste assurée par l’importeur FastReader. Une réponse HTML de connexion ou d’erreur ne devient pas un faux EPUB.

L’annulation d’une recherche ne supprime pas celle d’un autre lecteur : seules les réponses achevées sont partagées. Les délais libèrent les créneaux occupés. Un refus HTTP 401/403/429 suspend les nouvelles requêtes pendant au moins une minute, cinq minutes par défaut, sans nouvelle tentative sur un miroir ou un autre endpoint.

## Vérifications automatiques

`npx vitest run tests/ebookzy.test.js tests/ebookzy-server.test.js` : 30 tests réussis. Ils couvrent le parsing, les faux résultats, la pagination, les adresses autorisées, les formats, les signatures et limites de taille, les refus, les redirections, les cookies, CORS, l’annulation indépendante, les délais et le cache borné.

`tests/e2e/ebookzy.spec.js` couvre une recherche Shakespeare avec réponses contrôlées, le titre long et son auteur à 320 px, la couverture, le clic « Lire », IndexedDB, le mode Mot à mot, la bibliothèque, le rechargement hors ligne et le téléchargement Classique inchangé. Il couvre aussi l’échec facultatif de la couverture et l’absence de faux livre lorsqu’un EPUB échoue. Son exécution est à confirmer après la construction coordonnée de l’application. Aucun test automatique ne sollicite le catalogue réel en CI.
