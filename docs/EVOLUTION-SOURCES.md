# Réglages de lecture et nouvelles sources — 12 septembre 2026

| Page ou parcours | Comportement livré | Vérifications |
| --- | --- | --- |
| Accueil | Sépia et Verdana par défaut ; favicon verte ; suggestions conservées lors des changements de thème | Navigateur à 320 px, trois profils, cycle des thèmes, contrôle des assets |
| Recherche / Découvrir | Bibliothèque en tête ; Gutenberg local, Standard Ebooks anglais et ELG français en parallèle ; résultats et couvertures ouvrables dès leur arrivée ; focus et filtres conservés pendant les réponses tardives ; source nommée sur chaque carte | Retard ELG, panne isolée, annulation, pagination, ouverture des trois sources |
| Ma bibliothèque | Seuls les EPUB importés ou ouverts ; fichier original et progression conservés ; illustration Standard Ebooks conservée hors ligne | IndexedDB, rechargement, reprise, sauvegarde/restauration |
| Lecteur | Ordre Mot à mot, Focus, Classique ; nouvelle ouverture en Mot à mot sans démarrage automatique ; Classique si réduction des mouvements ; Verdana et cinq autres choix de familles locales | Commandes, préférences, reprise exacte, affichage mobile, choix des six polices |
| Focus | Graisse 700, différence de couleur adoucie, texte et surlignages lisibles dans les trois thèmes | Contrastes ≥ 4,5:1 avec le fond et audits axe |
| Paramètres | Disponibilité rouge/verte accompagnée de texte ; résultats progressifs, nouvelle vérification, annulation à la fermeture ; sources et droits, lien Open SLUM | Clavier, retour du focus, mobile, trois thèmes, cache, erreurs et délais |
| Exports | Original pour toutes les archives conservées ; Classique/Focus pour les éditions autorisant ces exports ; original uniquement par défaut pour les éditions ELG | Original conservé à l’import et dans la sauvegarde, commandes adaptées à la provenance |

Les cinq langues traduites en plus du français comprennent les nouveaux réglages, états et informations de droits. Le thème déjà choisi par un utilisateur reste conservé.

## Sources réellement essayées

- Standard Ebooks : recherche et EPUB compatibles directement depuis le navigateur ; *Pride and Prejudice* et *Frankenstein* importés lors des essais. Son catalogue reçoit les mots recherchés.
- Ebooks libres et gratuits : recherche OPDS par titre, filtrage EPUB, relais FastReader ; *Candide* importé et conservé après rechargement. La source impose un débit mesuré et 50 tentatives de téléchargement sur 24 heures pour le service. Les licences varient selon l’édition ; l’archive originale et ses crédits restent inchangés.
- Gutenberg : recherche dans le catalogue local et EPUB via les miroirs autorisés ; téléchargement direct maintenant raccordé à GitHub Pages.
- Z-Library : recherche/acquisition non validées sur l’hôte demandé, qui a renvoyé une boucle de redirections. Présenté comme indisponible dans les paramètres, sans faux résultat ni promesse d’ouverture directe.
- Open SLUM : lien externe vers un annuaire de disponibilité, sans validation des droits de ses ressources.

Les livres, positions et annotations restent dans le navigateur. Seuls les termes de recherche externes et les demandes de livres publics passent aux sources concernées. Le site rappelle de vérifier le domaine public applicable ou l’autorisation nécessaire selon son pays.

Le [rapport de validation](VALIDATION.md) distingue les tests avec réponses contrôlées et les essais réseau réels. [Audit Standard Ebooks](SOURCE-STANDARDEBOOKS-AUDIT.md) · [Audit ELG](SOURCE-EBOOKS-GRATUITS.md) · [Service Cloudflare](SOURCE-RELAY-DEPLOYMENT.md).
