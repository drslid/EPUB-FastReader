# Loyal Books — recherche officielle et lecture directe

État de l’intégration après recontrôle du **12 septembre 2026** : Loyal Books utilise son moteur public Google Programmable Search dans un panneau distinct. **L’ancien index local partiel et son collecteur ont été supprimés.** La recherche inclut l’anglais ; elle porte sur les pages indexées par Google, sans garantir que chaque résultat fournisse un EPUB ni que toutes les éditions du site soient indexées.

## Preuves et rectification du premier audit

Les preuves locales du recontrôle sont conservées dans `.cache/loyal-search-review/` : `home.json`, `emma-visible.json`, `candide-embed.json`, `robots.txt` et `RECHECK.md`. Ce répertoire de travail n’est pas une dépendance du produit.

- À **20:18:47 UTC**, la recherche « Emma » depuis l’accueil aboutit à [`/search?q=Emma`](https://www.loyalbooks.com/search?q=Emma). Google affiche environ 351 résultats, dont *Emma* de Jane Austen en deuxième position. Les dix résultats visibles comprennent neuf fiches de livres et une page d’auteur. L’absence de fiches dans l’ancienne extraction de la liste anglaise ne signifiait donc pas que la recherche anglaise était indisponible.
- À **20:20:37 UTC**, le prototype local du composant officiel recherche « Candide » et reçoit dix résultats, dont les éditions française et anglaise. La sélection de la fiche française fonctionne ; l’attribution Google est visible et le module d’annonces Google se charge. Aucun EPUB n’est acquis pendant ce recontrôle.
- La première preuve du prototype ajoutait aussi une action à certains liens `/feed`. Cette limite est identifiée dans `RECHECK.md` : le code du produit accepte seulement le chemin exact `/book/{slug}`. Les liens audio, auteurs, langues et autres résultats restent affichés par Google avec leur fonctionnement d’origine.

Le [`robots.txt`](https://www.loyalbooks.com/robots.txt) observé indique `Content-Signal: search=yes`, `Crawl-Delay: 60` et `Disallow: /search/`. La navigation publique observée est **`/search?q=…`, sans barre oblique finale**. Le premier audit assimilait trop largement ces chemins et les limites du collecteur. Ces directives de collecte ne sont pas un mécanisme d’authentification ; elles ne suffisent pas à conclure que le formulaire public est inaccessible. Voir aussi la [distinction précisée par la RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html#section-1).

## Composant Google et séparation des résultats

Le site charge `https://cse.google.com/cse.js?cx=71dbe754842244413`. La valeur `cx` est l’**identifiant public du moteur**, pas une clé API secrète. FastReader charge ce même composant standard et utilise ses méthodes publiques `render`, `getElement` et `execute`, ainsi que ses callbacks `starting` et `rendered`. Il n’appelle pas directement les endpoints internes de Google, ne récupère ni ne réutilise leur jeton, et n’utilise pas l’API JSON qui nécessite une clé propre. Référence : [documentation officielle du Search Element](https://developers.google.com/custom-search/docs/element).

Dans `src/loyal-search-panel.js`, Google conserve ses résultats, leur ordre, leurs liens, les promotions, les annonces, l’attribution et la pagination. FastReader ajoute uniquement une action secondaire **Lire** aux fiches admissibles. Le callback public de rendu est précisément le point d’extension documenté pour ce type d’action. Aucun résultat n’est converti en carte de la grille fédérée et aucune page non EPUB n’est masquée artificiellement. La séparation et la conservation des annonces/attributions correspondent aux points examinés dans les [conditions Programmable Search](https://support.google.com/programmable-search/answer/1714300), notamment §1.4, §1.6 et §2.3 ; la réussite technique du prototype ne constitue pas une garantie de disponibilité durable du moteur.

Le lecteur sélectionne **Loyal Books** puis utilise la barre de recherche existante. Ce panneau gère toutes les langues, dont l’anglais : le filtre de langue de FastReader y est retiré plutôt que de laisser croire à un filtrage que le composant ne fournit pas. Google gère sa propre pagination. La recherche « Tout le catalogue » ne lance pas Loyal Books et n’additionne pas les résultats Google à ceux des autres sources.

## Confidentialité et cycle de vie

Créer le panneau ou l’ouvrir avec une requête vide ne charge aucun script Google. Le composant est chargé à la première requête non vide dans la vue Loyal Books explicitement sélectionnée. Le texte saisi est alors transmis à Google ; cette transmission et le lien vers sa [politique de confidentialité](https://policies.google.com/privacy) sont indiqués dans le panneau. Les EPUB, notes et repères ne sont pas transmis par FastReader à ce moteur et restent dans le stockage du navigateur.

Les recherches globales dans un contexte qui n’a pas activé Loyal Books ne chargent pas Google. Les vérifications Pages bloquent et comptent toute tentative contraire. Une fois le script tiers chargé, il reste dans le document : quitter le panneau empêche FastReader de lancer de nouvelles recherches et ignore les callbacks périmés, mais l’API publique ne permet pas d’annuler une requête Google déjà émise. Une erreur ou un délai dépassé laisse disponibles **Réessayer** et le lien vers la recherche officielle de Loyal Books.

## De la fiche choisie à l’EPUB local

Une action Lire accepte uniquement une URL HTTP ou HTTPS de `www.loyalbooks.com`, sans port personnalisé, identifiants, paramètres ni fragment, et avec le chemin exact `/book/{slug}`. Le lien Google original reste intact. Seul le slug Unicode décodé et validé est transmis au lecteur ; le relais reconstruit sa propre URL HTTPS officielle. Aucun résultat ne peut fournir une URL arbitraire de téléchargement.

`src/sources/loyalbooks.js` expose le plugin **2.0.0**, `resolveLoyalbooksBook`, `loyalbooksAvailable` et `downloadLoyalbooksCover`. Son manifeste porte `searchPresentation: "embedded"` et `searchPrivacy: "external"`. Sa méthode `search()` renvoie un résultat marqué `embedded` sans accès réseau ni index local ; ce résultat technique vide n’est pas affiché comme un décompte Google.

| Route GET | Comportement |
| --- | --- |
| `/api/sources/loyalbooks/detail/{slug}` | Consulte la fiche publique, exige un EPUB annoncé et renvoie titre, auteur, langue renseignée, couverture et provenance sûrs. Aucun EPUB n’est téléchargé à cette étape. |
| `/api/books/loyalbooks/{slug}.epub` | Résout le lien EPUB annoncé par la fiche, acquiert l’archive et la valide avant de la transmettre. |
| `/api/sources/loyalbooks/cover/{slug}.jpg` | Résout la couverture de la fiche et récupère son image JPEG ou PNG. |

Identités : `loyalbooks-{slug}` et `loyalbooks:{slug}`. La réponse détail ne divulgue pas d’URL de téléchargement utilisable comme instruction arbitraire. Le client revalide l’identité, les métadonnées et les adresses attendues, puis reconstruit la provenance et le lien vers les conditions de la source.

La fiche réelle [*Emma* de Jane Austen](https://www.loyalbooks.com/book/emma-by-jane-austen) a été relue une fois, en HTTP 200, pendant l’implémentation de cette résolution, sans acquisition EPUB. Son titre se trouve dans `h1 / span[itemprop="name"]`, son auteur dans `.book-author / a[itemprop="author"]`, et sa couverture sous `/image/detail/Emma-Jane-Austen.jpg`. Les avis comportent également des champs `name` et `author` : ils ne doivent pas remplacer des métadonnées manquantes. Le serveur refuse une fiche sans titre ou auteur exploitables ; il garde une langue absente vide, sans déduire l’anglais de la langue de la page, et conserve une couverture absente comme telle.

Après résolution, le bouton Lire suit l’import ordinaire : EPUB conservé en IndexedDB, mode mot à mot, couverture téléchargée si disponible et reprise locale. L’échec de la couverture optionnelle ne bloque pas l’EPUB. Un livre déjà présent est ouvert depuis la bibliothèque sans nouvelle résolution ni acquisition. Les droits varient selon l’édition et le pays ; le livre garde son lien source et le rappel associé.

## Limites du relais

- Origine amont unique : `https://www.loyalbooks.com`. Aucun miroir, compte ou cookie utilisateur n’est utilisé ; les redirections sont refusées.
- EPUB annoncé sous `/download/epub/`, couverture sous `/image/detail/`, noms et chemins validés. Les liens présents uniquement dans scripts, commentaires ou attributs détournés ne sont pas des offres EPUB.
- Origine appelante et prérequêtes CORS contrôlées ; seules les requêtes GET acquièrent des données.
- Délai maximal de 35 secondes pour une résolution ou un EPUB, 4 secondes pour une couverture ; annulation propagée et places libérées.
- Fiche limitée à 1 Mio, EPUB à 30 Mio, couverture à 1 Mio, y compris les flux sans `Content-Length`. La réponse JSON détail est aussi limitée à 32 Kio côté client.
- Signature ZIP, `mimetype` et conteneur EPUB contrôlés ; taille compressée du membre `mimetype` bornée avant décompression. Signatures JPEG/PNG contrôlées, SVG refusé.
- Un EPUB, deux couvertures et deux résolutions de fiche simultanés au maximum. HTTP 401, 403 et 429 interrompent l’accès avec temporisation, sans nouvelle identité ni adresse alternative.
- Cache partagé de 16 fiches pendant cinq minutes : titres, auteurs et langues bornés, deux URL validées. Aucun HTML, cookie, EPUB ou contenu d’image n’y est conservé.

## Historique conservé, sans dépendance active

Le premier essai du **12 septembre 2026 à 19:48:30 UTC** avait constitué un snapshot de 499 notices sur cinq langues — français, espagnol, italien, allemand, portugais — avec 207 couvertures. L’extracteur de listes n’obtenait pas de fiches anglaises. Cette sélection incomplète a été abandonnée après le recontrôle du moteur public, qui trouve notamment Emma en anglais.

`public/catalog/loyalbooks.json`, `scripts/update-loyalbooks.mjs`, `tests/loyalbooks-generator.test.js` et le script npm `catalog:loyalbooks` ont été supprimés. Il n’existe plus de tâche d’actualisation, de pagination locale à collecter ni d’index Loyal Books à publier. Les anciennes données d’audit dans `.cache/` ne pilotent plus le produit.

L’audit initial avait aussi enregistré une acquisition anonyme d’Emma : **365 971 octets**, EPUB/ZIP valide, titre Emma, auteur Jane Austen, langue `en`, 18 éléments dans l’ordre de lecture et identifiant Gutenberg 158. Ces mesures sont un **constat historique**, distinct des preuves de recherche et des tests simulés actuels ; elles ne sont pas présentées comme un nouveau téléchargement du panneau publié. La présentation de [Loyal Books](https://www.loyalbooks.com/about) indique notamment des textes issus de Project Gutenberg et des enregistrements de LibriVox : les résultats ne garantissent pas des œuvres inédites par rapport aux autres catalogues.

## Validation reproductible

- `tests/loyalbooks.test.js` : recherche embarquée sans requête d’index, résolution client contrôlée, Unicode, configuration du relais, téléchargement et couverture, archivage inchangé, refus et annulation.
- `tests/loyalbooks-detail-server.test.js` : métadonnées réelles du balisage de fiche, absence de langue, refus des données incomplètes, absence d’acquisition pendant la résolution, cache borné, chemins, CORS, délais et concurrence.
- `tests/loyal-search-panel.test.js` : chargement différé, callbacks documentés, liens admissibles, conservation des résultats/annonces/attributions, stabilité du DOM, erreurs et réponses périmées.
- `tests/e2e/loyalbooks.spec.js` : scénario navigateur du panneau et de l’import, avec composant Google et réponses fournisseur simulés. Les preuves du moteur public sont les captures datées ci-dessus, pas ces fixtures.
- `scripts/verify-pages.mjs` et `scripts/verify-pages-relay.mjs` : parcours global Pages et lecture locale, sans mock de snapshot, avec blocage et assertion explicite de zéro requête Google et zéro lecture de l’ancien index.

Les **57 tests** ciblant le client, le relais de détail et le Worker ont réussi après leur modification. Les validations Pages ont également réussi sur des builds temporaires isolés : **9 contrôles statiques sous Chromium**, puis **6 contrôles avec relais simulé sous Chromium et 6 sous WebKit**. Elles confirment zéro tentative Google et zéro accès à l’ancien index, ainsi que la reprise hors ligne. Le build principal et le serveur des autres tests n’ont pas été modifiés. La validation finale du panneau intégré est consignée séparément dans `VALIDATION.md`.
