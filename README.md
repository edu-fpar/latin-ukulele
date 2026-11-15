# Ukulele Latino — entraîneur de rythme

Un groupe virtuel (guiro, conga, basse, clave…) joue avec toi, accélère petit à petit, et t'affiche en temps réel l'accord, le prochain changement et le coup de main droite à jouer.

## Lancer

- **Avec UwAmp** (Apache démarré) : http://localhost/latin-ukulele/
- **Sans UwAmp** : double-clic sur `lancer.cmd` (nécessite Node.js) → http://localhost:8642/

> Ouvrir `index.html` directement par double-clic ne marche pas (le navigateur bloque la lecture des fichiers JSON).

## Les 5 dimensions travaillées

| Dimension | Comment l'outil t'aide |
|---|---|
| 🥁 Rythme | grille de grattage avec la case « maintenant » allumée, comptage « 1 et 2 et » |
| ✋ Accords | diagramme de l'accord en cours + cadre « ensuite » qui s'allume avant le changement |
| ⏱️ Tempo | accélération automatique (+N bpm toutes les N boucles), bouton « 🐢 Trop vite ! », record sauvegardé |
| 👂 Écoute | pistes du groupe visibles et coupables, guide ukulélé qui s'efface, **défi silence** (1 mesure sur 4 sans rien), **accompagner une mélodie** jouée par une flûte, un accordéon ou une trompette, avec structure couplet/refrain |
| 🎵 Mélodie | riffs en tablature simplifiée (`A3` = corde de La, case 3) |
| 🤌 Picking | jeu aux doigts corde par corde (`C.F.G.F.` : pouce sur les temps, pincés sur les contretemps), arpèges qui suivent les accords |

## Ajouter du contenu

Tout est dans des fichiers JSON (`data/`) au même format, appelé « bundle » :
`{ "chords": {...}, "styles": [...], "packs": [ { "exercises": [...] } ] }`.
La spécification complète est dans [docs/prompt-ia.md](docs/prompt-ia.md).

**Le plus simple** : bouton « ✨ Ajouter des exercices avec une IA » → décris ce que tu veux → « Copier le prompt » → colle-le dans n'importe quelle IA → colle sa réponse → « Vérifier et importer ». Le prompt contient déjà le format, la liste de ce qui existe et ta progression.

**Pour rendre un import permanent** : « ⬇ fichier » dans la liste des imports, place le fichier dans `data/packs/`, ajoute son nom dans `data/manifest.json`.

## Organisation

```
index.html          page
css/style.css       apparence
js/engine.js        synthèse audio (ukulélé Karplus-Strong, percussions, basse)
js/player.js        compilation d'un exercice + horloge précise (Web Audio)
js/app.js           interface, progression, import IA
data/manifest.json  liste des fichiers chargés
data/chords.json    dictionnaire d'accords (cases G C E A)
data/styles/        un style = des pistes de percussions/basse
data/packs/         parcours d'exercices
docs/prompt-ia.md   prompt + format donné à l'IA
```
