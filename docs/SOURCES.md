# Sources, recherche et droits

## Ajouts du 12 septembre 2026

Z-Library a été retirée à la demande de l’utilisateur. Le filtre initial de recherche vaut **Toutes les langues**, y compris lorsqu’on sélectionne un catalogue anglophone ou francophone. Un filtre de langue choisi explicitement reste respecté ; les recherches partagées conservent ce choix dans leur URL.

- **Ebookzy** : recherche HTML publique en anglais, couvertures, acquisition de l’EPUB annoncé dans la fiche et ouverture directe. La couverture sélectionnée est conservée à l’import. [Audit](SOURCE-EBOOKZY-AUDIT.md).
- **Atramenta** : adaptateur pour la section française de lecture libre avec téléchargement annoncé. La boutique payante et les extraits sont exclus. Le parcours respecte la session anonyme et le quota partagé. L’essai depuis le relais Cloudflare public a toutefois reçu un refus (`503 SOURCE_BUSY`) : la source reste signalée indisponible, sans acquisition ni autre tentative. [Audit](SOURCE-ATRAMENTA-AUDIT.md).
- **Loyal Books** : recherche locale dans une sélection datée de 499 notices EPUB en français, espagnol, italien, allemand et portugais, avec couverture, source et accès au fichier annoncé par la fiche. Le catalogue anglais n’a pas fourni de liste exploitable lors de la collecte. Le nombre de notices indexées est affiché ; l’interface ne revendique pas la recherche de tout le catalogue. [Audit](SOURCE-LOYALBOOKS-AUDIT.md).
- **BDEbooks** : évalué séparément, sans activation comme source connectée tant que la recherche et le téléchargement ne peuvent pas être validés derrière sa protection d’accès.

Les adaptateurs ont chacun leur contrat et leurs tests ; les résultats sont publiés progressivement, sans attendre une source lente pour afficher les autres. Les codes de quota, connexion requise et attente sont distingués et traduits. Les comptes des lecteurs et leurs bibliothèques restent hors du relais.

L’index Loyal Books se régénère avec `npm run catalog:loyalbooks`. Le collecteur accepte `--pages-per-language` pour étendre sa couverture, conserve sa reprise et son délai minimal de 60 secondes entre requêtes dans `.cache/`, et ne publie qu’un fichier validé complet pour les pages demandées. Il ne télécharge pas les livres. Cet outil et ses détails de maintenance sont séparés du README destiné aux lecteurs.

Le reste de ce document conserve l’historique des premières intégrations.

## Pourquoi la recherche ne fonctionnait pas

Diagnostic du 10 septembre 2026, avec de vraies requêtes réseau :

- La requête Gutendex `books/?copyright=false&mime_type=application%2Fepub%2Bzip&sort=popular&page=1&search=hugo&languages=fr` a expiré après 20 secondes sans recevoir un octet. Les anciens tests simulaient un service disponible et ne démontraient pas sa disponibilité réelle. [Gutendex](https://gutendex.com/) recommande d’ailleurs un serveur propre pour un usage durable.
- L’EPUB Gutenberg `cache/epub/135/pg135-images-3.epub` répondait HTTP 200 mais sans `Access-Control-Allow-Origin`, y compris avec un en-tête `Origin` représentant notre site. Le miroir officiel ODU présentait la même absence d’autorisation CORS pour l’EPUB testé. Un lien de téléchargement dans une fiche fonctionne ; un `fetch` JavaScript depuis un autre site est bloqué par le navigateur.
- La sélection précédente ne contenait que trois œuvres. Elle ne suffisait pas à rendre utile une recherche d’autres auteurs pendant une panne de Gutendex.

La recherche de production ne dépend plus de Gutendex. La recherche Gutenberg charge des fichiers de catalogue du site puis cherche localement. Les recherches Standard Ebooks sont transmises à son site public ; celles d’Ebooks gratuits, Faded Page et epubBooks passent par le relais FastReader puis leurs interfaces publiques. Les livres personnels, annotations et positions ne sont transmis à aucune source.

## Fonctionnement livré

Le snapshot du 10 septembre 2026 contient **77 506 notices d’EPUB**, en **43 langues**, dont **4 163 en français**. Seules les notices RDF déclarant explicitement `Public domain in the USA.` et offrant un format EPUB sur l’hôte officiel sont retenues. Ce chiffre compte des éditions, pas nécessairement des œuvres uniques ; plusieurs tomes, traductions ou éditions d’un titre peuvent coexister.

Les métadonnées proviennent de l’archive RDF officielle, récupérée avec le service rsync recommandé : `rsync.ibiblio.org::gutenberg-epub/feeds/rdf-files.tar.bz2`. Project Gutenberg autorise expressément la création de catalogues à partir de ses [métadonnées numériques](https://www.gutenberg.org/ebooks/offline_catalogs.html), placées dans le domaine public selon sa [politique d’accès automatisé](https://www.gutenberg.org/policy/robot_access.html). Son site de navigation n’est pas aspiré.

Le moteur Gutenberg cherche les mots du titre et de l’auteur, indépendamment de leur ordre, de la casse, des accents, des apostrophes et des tirets. Les ligatures `œ/oe` et `æ/ae` sont équivalentes. Les titres identiques à la requête sont favorisés, puis viennent les titres qui commencent par celle-ci, puis la popularité fournie par le snapshot. Son total et sa pagination de 24 notices au maximum sont exacts pour les notices filtrées. Les identifiants Gutenberg dédupliquent les notices multilingues et les éditions intégrées. Les fournisseurs distants conservent leur propre sémantique de recherche et peuvent ne renvoyer qu’une sélection des correspondances.

| Plugin                  | Version | Comportement                                                                   |
| ----------------------- | ------- | ------------------------------------------------------------------------------ |
| `selection`             | 1.1.0   | Neuf EPUB complets servis ici, lecture directe                                 |
| `gutenberg`             | 3.0.0   | Catalogue officiel local, puis récupération de l’EPUB et ouverture via le relais |
| `all`                   | 4.0.0   | Recherche commune progressive ; l’édition intégrée est prioritaire sur sa notice Gutenberg |
| `standard-ebooks`       | 1.0.0   | Recherche anglaise publique, couvertures et EPUB direct depuis le navigateur |
| `ebooks-gratuits`        | 1.0.0   | Recherche française par titre, EPUB uniquement, relais et résultats progressifs |
| `fadedpage`              | 1.0.0   | Recherche anglaise par titre, couvertures, EPUB via le parcours public de la source |
| `epubbooks`              | 1.0.0   | Recherche anglaise, couvertures et EPUB via le téléchargement public de la source |
| `public-domain-library` | 1.0.0   | Lien vers le site externe                                                      |

La recherche affiche **un livre par ligne**, avec une couverture illustrée lorsqu’elle est disponible, sinon une couverture typographique locale. Les titres complets, auteurs et sources restent visibles. Le filtre initial est **Toutes les langues** ; les livres personnels correspondants précèdent les résultats externes. `downloadMode: "bundled"` identifie les neuf éditions intégrées, `"direct"` les catalogues ouvrables. Un clic sur la couverture ou **Lire** récupère le fichier, importe le livre dans IndexedDB et ouvre le lecteur. Si une correspondance existe déjà dans la bibliothèque, l’application ouvre cette copie locale et conserve ses repères sans refaire le téléchargement. La correspondance se fait par identifiant de source ou, pour un EPUB personnel sans provenance, par titre et auteur normalisés, avec une langue compatible. Deux identifiants canoniques explicitement différents ne sont pas assimilés par ce rapprochement. Dans ce dernier cas, l’édition personnelle reste utilisée avec son contenu et ses propres chapitres.

La liste **Catalogue externe** a été retirée. Le lien **Source** reste disponible pour consulter l’origine et les droits, mais l’action principale ouvre le livre dans FastReader. Un téléchargement indisponible n’ajoute pas de livre : le message propose **Réessayer** et, en solution de repli, la fiche source et l’import manuel. Quitter la page pendant le téléchargement annule la requête côté navigateur et empêche l’ouverture tardive du lecteur.

L’accueil utilise les mêmes éditions intégrées pour ses trois suggestions. Leur choix est local : renouvellement du groupe précédent, puis priorité aux œuvres absentes de la bibliothèque et diversité des auteurs et des genres. Les suggestions changent au démarrage ou par le bouton **D’autres idées**. La dernière sélection est conservée dans IndexedDB pour réduire les répétitions ; les propositions restent stables pendant la navigation. Leur simple affichage n’ajoute aucun livre à la bibliothèque.

Si le catalogue local n’est pas encore chargé et que son hébergement est inaccessible, la recherche commune garde les œuvres intégrées correspondant à la requête et affiche un avertissement explicite. L’absence de connexion n’est donc pas présentée comme une recherche complète ne trouvant rien. Une annulation reste une annulation.

## Récupération des EPUB publics

Pour Gutenberg, le navigateur appelle le service configuré : `GET /api/books/gutenberg/<identifiant>.epub`. Le serveur construit l’adresse auprès des miroirs PGLAF ou ODU figurant dans la [liste officielle Gutenberg](https://www.gutenberg.org/MIRRORS.ALL). Il ne télécharge aucun livre au simple affichage d’une recherche. Le recours à ces miroirs suit le [guide de distribution](https://www.gutenberg.org/help/mirroring.html) ; le site principal de navigation n’est pas aspiré. L’absence de CORS sur les fichiers sources est ainsi gérée par notre service HTTP, sans proxy tiers arbitraire ni demande de réglage au lecteur.

Pour limiter le téléchargement sur mobile, le relais demande d’abord `pg<identifiant>.epub`, l’édition texte légère fournie par Gutenberg. Si elle est absente avec un statut 404, il peut utiliser la variante `pg<identifiant>-images.epub`. Ce sont les fichiers originaux proposés par la source : l’application ne réécrit pas leurs octets, leur contenu ou leurs licences. L’EPUB téléchargé est conservé localement et exportable. Une édition ancienne du snapshot peut néanmoins manquer ou être momentanément inaccessible sur les miroirs.

Le relais accepte seulement un identifiant numérique, pas une URL arbitraire. Il refuse les redirections et les méthodes autres que GET/HEAD ; les statuts d’accès restreint ou de surcharge ne déclenchent pas de contournement par un autre miroir. Les réponses ont une limite de 30 Mio vérifiée pendant la lecture, un délai maximal de 20 secondes et un contrôle du type et de l’en-tête EPUB. L’import dans le navigateur applique ensuite les validations complètes de l’archive. Quatre téléchargements distincts peuvent être en cours ; les requêtes simultanées du même livre sont regroupées. Un cache mémoire de fichiers publics est limité à 64 Mio, avec une validité de six heures.

Ce service ne reçoit aucun EPUB personnel, aucune note ou position. Il reçoit les recherches destinées aux catalogues ELG, Faded Page et epubBooks, ainsi que les identifiants des livres publics à récupérer. Il n’utilise ni compte ni base de données personnelle. Faded Page et epubBooks créent une session anonyme pour le parcours public de téléchargement ; elle reste limitée à cette opération côté relais et n’est pas transmise au lecteur. Les identifiants de livres publics passent nécessairement par le serveur lors de leur premier téléchargement. La sélection intégrée, les imports et les livres déjà enregistrés restent lisibles sans ce relais. `npm run dev`, `npm run preview` et le serveur de production incluent les routes ; un hébergement statique seul ne les fournit pas. Voir [DEPLOYMENT.md](DEPLOYMENT.md) et les [routes et limites par fournisseur](SOURCE-RELAY-DEPLOYMENT.md).

## Taille et maintien du catalogue

`src/sources/catalog-manifest.json` déclare la date, la provenance, l’empreinte de l’archive et tous les fichiers autorisés. Les fichiers `public/catalog/<langue>-<partie>-<empreinte>.json` regroupent au maximum 2 500 notices et mutualisent les noms d’auteurs. Leur nom inclut les 12 premiers caractères du SHA-256 de leur contenu : un catalogue actualisé ne réutilise pas un fichier d’une ancienne version.

Le français complet occupe **340 587 octets** dans deux fichiers ; toutes les langues réunies occupent **7 032 460 octets**. Le moteur ne charge que la langue choisie, avec quatre requêtes concurrentes au maximum, et garde les fichiers déjà lus en mémoire. « Toutes les langues », désormais le filtre initial de recherche, charge l’ensemble de l’index. Choisir une langue limite ce téléchargement. Le service worker précharge le français et conserve les autres langues après leur première consultation ; l’anglais complet représente environ 5,76 Mo avant compression HTTP.

L’index décrit les notices disponibles à sa date de génération. Il ne se met pas à jour secrètement pendant la lecture et ne garantit pas la présence de publications ajoutées depuis. Pour préparer une mise à jour :

```sh
python3 scripts/update-catalog.py
# Ou réutiliser une archive déjà récupérée :
python3 scripts/update-catalog.py --archive /chemin/rdf-files.tar.bz2
```

L’outil nécessite Python 3 et rsync. Il récupère l’archive officielle dans un dossier temporaire, parcourt les membres sans extraire leurs chemins, rejette les déclarations d’entités XML et refuse de remplacer le snapshot par un catalogue incomplet. L’archive RDF d’environ 127 Mo est un fichier de développement, **jamais un asset téléchargé par les utilisateurs**. Les EPUB complets ne sont pas récupérés par cette commande.

Relire les changements de notices, exécuter les tests, puis déployer les fichiers JSON, le manifeste et le code ensemble. Le build normal utilise le snapshot contrôlé dans le dépôt et ne dépend pas du réseau Gutenberg.

## Les neuf éditions intégrées

Les fichiers originaux sont conservés sans modification, avec leur couverture, leur texte, leurs crédits et leur licence. Ils sont distribués gratuitement et représentent **2 586 765 octets** au total.

Chaque édition possède également un repère `readingStart` contrôlé sur son texte réellement importé. Il permet de commencer au récit, à la préface ou à la dédicace à la première ouverture, sans faire défiler mot à mot la notice technique anglaise ou la table des matières. Les préfaces de _Candide_, de _Notre-Dame_ et du _Dernier Jour_, ainsi que la dédicace de _Madame Bovary_, sont conservées dans ce parcours. Une position de lecture déjà sauvegardée reste prioritaire. Aucune partie de l’EPUB n’est supprimée.

| Œuvre                                   | Auteur            | Édition Gutenberg                               | Fichier local                |
| --------------------------------------- | ----------------- | ----------------------------------------------- | ---------------------------- |
| Le Horla                                | Guy de Maupassant | [10775](https://www.gutenberg.org/ebooks/10775) | `le-horla.epub`              |
| Trois contes                            | Gustave Flaubert  | [12065](https://www.gutenberg.org/ebooks/12065) | `trois-contes.epub`          |
| Candide, ou l’optimisme                 | Voltaire          | [4650](https://www.gutenberg.org/ebooks/4650)   | `candide.epub`               |
| Le tour du monde en quatre-vingts jours | Jules Verne       | [800](https://www.gutenberg.org/ebooks/800)     | `tour-du-monde.epub`         |
| Voyage au centre de la Terre            | Jules Verne       | [4791](https://www.gutenberg.org/ebooks/4791)   | `voyage-centre-terre.epub`   |
| Vingt mille lieues sous les mers        | Jules Verne       | [5097](https://www.gutenberg.org/ebooks/5097)   | `vingt-mille-lieues.epub`    |
| Notre-Dame de Paris                     | Victor Hugo       | [19657](https://www.gutenberg.org/ebooks/19657) | `notre-dame-paris.epub`      |
| Madame Bovary                           | Gustave Flaubert  | [14155](https://www.gutenberg.org/ebooks/14155) | `madame-bovary.epub`         |
| Le Dernier Jour d’un Condamné           | Victor Hugo       | [6838](https://www.gutenberg.org/ebooks/6838)   | `dernier-jour-condamne.epub` |

Chaque original a été récupéré individuellement dans le module `gutenberg-epub` via rsync, suivant le [guide officiel](https://www.gutenberg.org/help/mirroring.html). Les dates, tailles, empreintes et éléments de revue d’édition sont conservés dans `public/books/provenance.json`. Les tests ouvrent les neuf archives avec le parseur de production et vérifient leurs licences ainsi que leurs empreintes.

Les auteurs retenus sont morts entre 1778 et 1905 et leurs textes français anciens relèvent du domaine public patrimonial en France au regard de l’[article L123-1](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006278937). La revue porte aussi sur les contributions de l’édition : les notes de _Candide_ proviennent d’annotateurs anciens ; la préface du _Dernier Jour_ et la note de _Notre-Dame_ sont de Victor Hugo. _Vingt mille lieues_ reprend l’ancienne édition Hetzel, attribuant ses dessins à [Alphonse de Neuville, mort en 1885](https://catalogue.bnf.fr/ark%3A/12148/cb119175840.public). L’édition des _Fleurs du Mal_ examinée comportait une préface dont les droits locaux n’ont pas été suffisamment établis : elle n’a pas été ajoutée à la sélection intégrée.

Chaque EPUB déclare être libre aux États-Unis. Cela ne constitue pas une autorisation universelle pour toutes les éditions, les pays ou les résultats futurs. La [licence Project Gutenberg](https://www.gutenberg.org/policy/license) accompagne les fichiers et encadre leur redistribution et l’usage de la marque. La licence MIT du code ne la remplace pas. La page `books/NOTICE.html` donne les originaux, les sources, les empreintes et la licence complète. Aucun paiement pour l’accès aux livres n’a été ajouté.

Les couvertures Gutenberg ne sont pas chargées par hotlink : sa [politique d’images](https://www.gutenberg.org/policy/linking.html#image-inlining) impose de les copier sur le site qui les affiche. Les cartes utilisent des couvertures typographiques locales, identiques dans les suggestions, Découvrir et Mes livres. `source.presentation` conserve la clé visuelle, le titre et l’auteur du catalogue pour éviter qu’une différence de métadonnées ou l’image interne de l’EPUB remplace la couverture choisie. `src/covers.js` retrouve aussi les anciennes éditions enregistrées grâce à leurs identifiants de source. La couverture incorporée à l’EPUB reste dans les données originales ; elle est affichée pour un import personnel sans provenance de catalogue.

## Autres sources et futur développement

### Essais complémentaires du 12 septembre 2026

La sélection des prochaines sources se fait **après un essai de recherche, de récupération du contenu et d’import**, puis validation avec le propriétaire. Standard Ebooks, Ebooks gratuits, Faded Page et epubBooks ont ensuite été demandés et intégrés après vérification ; les autres pistes restent à valider.

- [Wikisource](SOURCE-WIKISOURCE-AUDIT.md) : recherche API accessible dans les six langues ; l’EPUB officiel de WS Export nécessite un relais. Une autre voie a été démontrée sur le recueil du *Horla* : fabrication de l’EPUB dans le navigateur via les API autorisées, 14 nouvelles et 1 458 paragraphes comparés avec succès, puis import réel. Ce prototype couvre une édition française contrôlée, pas tout le catalogue.
- [Bibebook et BEQ](SOURCE-BROWSER-CANDIDATES.md) : catalogues et EPUB testés ; leur accès direct externe échoue par CORS. Bibebook fournit un index de 1 722 notices et l’édition *Candide* examinée autorise la redistribution avec attribution et partage dans les mêmes conditions. Une sélection vérifiée pourrait donc être hébergée ici, sans relais. La taille et les droits de l’ensemble des fichiers ne sont pas validés.
- [Gallica et premier audit ELG](SOURCE-ALTERNATIVES-AUDIT.md), [Internet Archive / OAPEN](SOURCE-ARCHIVE-OAPEN-AUDIT.md) et [autres fournisseurs](SOURCE-TRANSPORT-AUDIT.md) : essais historiques. Les intégrations livrées Standard Ebooks et ELG sont décrites dans la section ci-dessous, avec leurs preuves complètes.

[Public Domain Library](https://publicdomainlibrary.org/en/ebooks) reste accessible par lien. Les pages consultées ne fournissent pas de contrat d’API publique permettant ici une intégration de recherche et téléchargement maintenable. Ses conditions et ses restrictions techniques doivent être clarifiées avant de livrer un adaptateur automatique ; changer simplement le nom de la source ne résout pas CORS.

Un prochain plugin pourra intégrer un catalogue OPDS ou une sélection redistribuable après vérification des droits et du contrat machine. Gutenberg utilise déjà le relais contrôlé décrit ci-dessus ; cette intégration ne donne pas automatiquement accès aux fichiers de toute autre source. Un proxy public arbitraire n’a pas été ajouté.

Une nouvelle vérification HTTP ciblée a confirmé la limite : les EPUB du Horla servis par les miroirs officiels ODU et PGLAF répondaient 200 sans `Access-Control-Allow-Origin`. L’export EPUB Wikisource, un EPUB Wolne Lektury et un EPUB ouvert d’Internet Archive présentaient également cette absence sur les réponses testées. Ces observations concernent ces endpoints à la date du test, pas une garantie sur tous les fichiers ou leur disponibilité future. Les miroirs Gutenberg examinés figurent dans la [liste officielle](https://www.gutenberg.org/MIRRORS.ALL), et la copie d’éditions supplémentaires peut suivre le [guide de miroir autorisé](https://www.gutenberg.org/help/mirroring.html).

**Wikisource reste une piste pour un futur plugin**, via son API MediaWiki plutôt que par téléchargement direct de WS Export. Une recherche réelle sur l’API française avec `origin=*` répondait avec CORS autorisé, conformément au [contrat MediaWiki](https://www.mediawiki.org/wiki/API:Cross-site_requests/en). Il reste à implémenter l’assemblage du livre depuis ses pages : ordre et complétude des chapitres, nettoyage, images éventuelles, attribution des contributions et licences. Aucun plugin de ce type n’est activé dans la version livrée. [WS Export](https://wikisource.org/wiki/Wikisource:WS_Export/en) est une référence de conversion, sans constituer ici une API EPUB accessible par `fetch` depuis le site.

Chaque plugin reste un module explicitement importé par `src/sources/registry.js`, avec identifiant stable, version sémantique et `apiVersion: 1`. Une réponse de catalogue ne peut installer ni exécuter du code. Ajouter une source demande de déclarer ses capacités, de définir la déduplication et les erreurs partielles, de vérifier un EPUB réel, puis de tester les parcours navigateur correspondant à ses capacités réelles.

## Vérification

`tests/catalog.test.js` exerce le véritable index publié, les requêtes Hugo/Misérables, l’équivalence des accents et des ligatures, les langues, la pagination, les limites, les empreintes et une véritable requête HTTP locale. `tests/sources.test.js` couvre le contrat de plugins, la sélection, les pannes partielles et la déduplication. `tests/sources-books.test.js` importe les neuf fichiers complets. `tests/sources-generator.test.js` vérifie l’exclusion des droits inconnus, fichiers non EPUB et hôtes détournés, ainsi que la lecture des membres RDF sans extraction de chemins.

Les parcours navigateur utilisent les vrais fichiers de catalogue et les neuf EPUB intégrés servis par l’application ; ils ne simulent plus un Gutendex fonctionnel pour démontrer la recherche principale. `discovery.spec.js` contrôle les couvertures de tous les résultats, le téléchargement automatique, l’ajout à la bibliothèque, la reprise sans nouvelle requête, les échecs avec nouvelle tentative et l’annulation par navigation. Les réponses de téléchargement Gutenberg des tests navigateur sont des fixtures déterministes ; elles ne démontrent pas à elles seules la disponibilité réelle d’un miroir.

`tests/relay.test.js` vérifie le relais avec des réponses contrôlées, notamment les miroirs et variantes, les délais, limites, redirections, erreurs et cache. `tests/server-app.test.js` exerce un vrai serveur HTTP local : fichiers publics, MIME, HEAD, santé, erreurs, traversées de chemins, liens symboliques sortants et branchement du relais. `cover-consistency.spec.js` utilise les EPUB réels de Candide et du Horla pour vérifier la même couverture avant/après import et rechargement, la compatibilité des anciens livres et les images des EPUB personnels. `home-suggestions.spec.js` contrôle la rotation locale et la reprise. Les résultats exécutés et les essais réseau réels sont consignés dans [VALIDATION.md](VALIDATION.md).

## Sources intégrées le 12 septembre 2026

La recherche commune publie les réponses indépendamment : sélection et index Gutenberg d’abord lorsqu’ils répondent vite, puis chaque catalogue externe. Les résultats déjà arrivés restent ouvrables ; changer de recherche ou ouvrir un livre annule les réponses devenues inutiles. Une panne est affichée par source. La pagination avance d’une page dans chaque fournisseur ; un total approximatif reste signalé comme tel.

- **Standard Ebooks** : recherche HTML publique, 24 résultats par page, anglais. La fiche donne le téléchargement EPUB compatible ; le plugin suit uniquement son éventuel rafraîchissement officiel vers le même fichier. CORS a été vérifié dans un navigateur. Les illustrations du catalogue et de l’EPUB sont identiques pour les éditions testées ; la couverture embarquée est conservée localement. [Audit](SOURCE-STANDARDEBOOKS-AUDIT.md).
- **Ebooks libres et gratuits** : OPDS officiel, français, recherche par titre et filtrage EPUB. Une réponse lente n’empêche pas les autres catalogues de répondre. Le relais respecte les limites de la source, dont 50 tentatives de téléchargement par 24 heures, globalement et de manière persistante sur le Worker. Les droits diffèrent selon l’édition : original préservé, exports convertis désactivés par défaut pour ce fournisseur. [Audit](SOURCE-EBOOKS-GRATUITS.md).
- **Faded Page** : formulaire public de recherche par titre, limité à l’anglais. Le relais transmet une requête lancée par le lecteur, met brièvement la réponse en cache et suit fiche publique → session PHP anonyme → EPUB annoncé par la fiche. Aucune collecte du catalogue entier. Les couvertures sont affichées depuis la source avec `referrerpolicy="no-referrer"` ; pour *Jane: A Story of Jamaica*, l’image et la couverture de l’EPUB sont identiques. Le fichier réel de 296 961 octets ouvre 28 chapitres dans FastReader. Les droits annoncés concernent le Canada et doivent être vérifiés ailleurs. [Audit](SOURCE-FADEDPAGE-AUDIT.md).
- **epubBooks** : recherche publique anglaise, sans pagination exhaustive ; le total est annoncé comme approximatif. La fiche permet un téléchargement EPUB anonyme, que le relais suit sans compte ni cookies du lecteur. L’EPUB réel de *Frankenstein* (`22-frankenstein`) mesure 270 697 octets. Sa couverture de catalogue est conservée lors de l’import afin de garder le même visuel dans la bibliothèque, y compris hors connexion. Les éditions originales et leurs licences sont préservées. [Audit](SOURCE-EPUBBOOKS-AUDIT.md).
- **Z-Library** : l’hôte demandé a renvoyé une boucle de redirections ; aucune recherche/acquisition EPUB automatisée n’a été validée. Il apparaît comme indisponible dans les paramètres et n’alimente pas les résultats. Aucun autre miroir ni accès protégé n’a été contourné.
- **Open SLUM** : lien externe vers un annuaire de disponibilité. Ce n’est pas un fournisseur EPUB intégré ni une validation des droits des bibliothèques qu’il répertorie.

Les paramètres indiquent la disponibilité vérifiée, avec texte et pastille ; un contrôle ne télécharge pas de livre. Le site rappelle que les droits dépendent du pays et qu’il faut un domaine public applicable ou une autorisation. Posséder un exemplaire ne suffit pas automatiquement à autoriser un autre téléchargement.

Le relais public `https://fastreader-sources.carbonnier-anthony.workers.dev` a répondu HTTP 200 pour le statut, la recherche ELG Candide, l’EPUB Gutenberg Alice (136 519 octets) et l’EPUB ELG Candide (1 530 924 octets), avec CORS pour `https://drslid.github.io`. [Exploitation du Worker](SOURCE-RELAY-DEPLOYMENT.md).
