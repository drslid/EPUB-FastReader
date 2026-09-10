const chapters = [
  [
    "Un peu de place",
    `<p>Ce matin, Camille a laissé son téléphone dans l’entrée. Sur la table, une tasse de thé dessinait un cercle de vapeur. La fenêtre était entrouverte et la ville commençait doucement sa journée.</p><p>Depuis plusieurs semaines, les livres s’accumulaient près du canapé. Elle aimait leur présence, leurs couleurs, cette promesse silencieuse de voyages. Pourtant, elle attendait toujours le bon moment pour les ouvrir. Une soirée libre, un dimanche pluvieux, des vacances un peu plus longues.</p><p>Elle a pris le plus petit et l’a ouvert au hasard. Il n’était question ni de finir un chapitre ni de battre un record. Seulement de lire une page. Une vraie page, avec toute son attention.</p><p>Au bout de quelques lignes, quelque chose avait changé. La rue faisait le même bruit, le thé refroidissait de la même façon, mais ses pensées avaient trouvé un chemin. Une phrase en appelait une autre.</p><p>Lire commence parfois ainsi : on fait un peu de place et une histoire s’y installe.</p>`,
  ],
  [
    "Trouver son rythme",
    `<p>Le lendemain, Camille a retrouvé son livre exactement là où elle l’avait laissé. Elle avait cinq minutes avant de sortir. C’était assez.</p><p>Certains passages invitaient à ralentir. D’autres se parcouraient avec la légèreté d’une promenade familière. Elle a compris qu’il n’y avait pas une vitesse idéale pour tous les textes, ni même pour toutes les heures de la journée.</p><p>Elle a agrandi les caractères. Puis elle a essayé de mettre le début des mots en évidence. Ce petit changement lui plaisait ce matin-là. Un autre jour, elle préférerait peut-être retrouver une page toute simple.</p><p>Le plaisir de lire ne se mesure pas seulement au nombre de pages tournées. Il se trouve aussi dans une idée qui reste, un personnage que l’on comprend mieux, une question que l’on emporte avec soi.</p><p>Avant de fermer son livre, Camille a regardé la dernière phrase une seconde de plus. Elle savait maintenant où reprendre.</p>`,
  ],
  [
    "La prochaine page",
    `<p>Une semaine plus tard, le petit livre avait voyagé. Sur le banc d’un jardin, dans une salle d’attente, puis sous la lumière douce d’une lampe. À chaque fois, quelques minutes suffisaient pour retrouver le fil.</p><p>Camille n’avait pas transformé son emploi du temps. Elle avait simplement commencé à remarquer les petits espaces entre deux choses. Tous ne devaient pas être remplis, mais certains pouvaient accueillir une histoire.</p><p>Le soir, elle a terminé le dernier chapitre. Elle est restée un instant immobile, heureuse de ce voyage discret. Sur la table, les autres livres semblaient un peu moins lointains.</p><p>Elle en a choisi un nouveau, attirée par son titre et une couverture couleur de mer. Puis elle a ouvert la première page.</p><p>À vous de trouver votre prochaine lecture. Importez un EPUB dans votre bibliothèque, ou explorez les classiques depuis l’onglet Découvrir. Votre place vous attend.</p>`,
  ],
];

export function createDemo() {
  const items = chapters.map(([title, html], index) => ({
    id: `chapter-${index + 1}`,
    title,
    html,
    wordCount: html
      .replace(/<[^>]*>/g, " ")
      .trim()
      .split(/\s+/u).length,
  }));
  return {
    id: "fastreader-demo-v1",
    title: "L’art de prendre le temps",
    author: "Une pause avec FastReader",
    cover: "",
    language: "fr",
    chapters: items,
    totalWords: items.reduce((sum, item) => sum + item.wordCount, 0),
    addedAt: Date.now(),
    demo: true,
  };
}
