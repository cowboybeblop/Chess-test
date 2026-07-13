# Projet LLL — le modèle échecs pédagogue
*Charte du projet, état au 13 juillet 2026.*

## La vision

Créer un petit modèle de langage spécialisé échecs, "né" de la destruction
de deux parents : **Stockfish détruit en données** (millions de positions
étiquetées : évals, meilleurs coups, verdicts) et **un LLM open source
détruit en architecture de départ** (un transformer qui sait déjà parler).
Le troisième modèle qui en résulte n'est ni l'un ni l'autre.

**La métaphore fondatrice** (et c'est aussi le design d'entraînement) :
un personnage qui *connaît* toutes les positions mais a *perdu la mémoire* —
un savoir latent, enfoui, sans accès verbal. On le fait jouer et on le
laisse **poser des mots sur les positions** : le langage devient le point
d'ancrage et la méthode de réflexion. Traduction ML : phase 1 = distillation
de l'intuition (position → éval/coup), phase 2 = verbalisation
(position → observations → verdict → explication), et le format
"observations AVANT conclusion" (chain-of-thought) fait des mots les
marches de l'escalier, pas la décoration.

**Décision de cap : PÉDAGOGUE d'abord.** Le modèle doit d'abord bien
expliquer, la force de jeu viendra après (avec plus de calcul). Conséquence
directe : le dataset privilégie les **vraies parties humaines** (pleines
d'erreurs réelles à expliquer) plutôt que le self-play moteur (98% de
précision, rien à enseigner).

## L'architecture (séparation stricte des rôles)

- **La vérité** : Stockfish + le pipeline d'analyse de l'outil Chess-test
  (calibré sur Chess.com au point près). C'est LE professeur. Le modèle
  n'apprend qu'à verbaliser du vrai — protection contre la confabulation.
- **Le langage** : un petit modèle open source (Qwen 1.5B / Llama 3B),
  fine-tuné en LoRA.
- **Le test scientifique intégré** : si le modèle qui verbalise ses
  observations avant de conclure est plus précis dans ses verdicts que le
  même modèle forcé de répondre directement, alors le langage porte
  vraiment la réflexion. Mesurable avec notre propre pipeline. Critère
  d'échec clair.
- **L'examinateur** : le Lab de l'outil fera jouer le modèle final contre
  Stockfish bridé ; notre barre de précision mesurera son niveau.

## L'usine à données (construite, testée)

`factory/` dans le repo Chess-test :
- `factory.mjs` — PGN Lichess → JSONL d'entraînement. Une ligne par coup :
  `fen, san, verdict, ep_loss, eval, best_san, phase, opening, elos,
  observations[], explication_fr`. Réutilise **le pipeline exact de
  l'outil web** (analysis-core.js extrait de app.js + chess-logic.js +
  openings.js) : mêmes verdicts, mêmes bulles, même livre d'ouvertures.
- `engine-node.js` — adaptateur UCI pour Stockfish natif (même interface
  que le moteur navigateur).
- `lll-factory.yml` — workflow GitHub Actions : à copier dans
  `.github/workflows/`. Déclenchable depuis l'app GitHub mobile
  (Actions → Run workflow), il streame une tranche aléatoire de la base
  ouverte Lichess, analyse, et committe `dataset/part-*.jsonl`.

Mesuré en conditions réelles : ~5-6 exemples/seconde à profondeur 12-14
natif → **un job de 6 h ≈ 100 000 exemples**. Objectif dataset v1 :
50 000 à 200 000 exemples, soit 1 à 3 runs.

## Ce dont on a besoin (tout sans PC, depuis le téléphone)

1. **Déjà en place** : le repo GitHub (héberge l'usine + le dataset),
   les fichiers de l'outil (pipeline/livre), Stockfish (installé par le
   workflow lui-même).
2. **À créer (gratuit)** : un compte **Hugging Face** (stocker le modèle
   et le dataset final) ; un compte **Google Colab** et/ou **Kaggle**
   (GPU gratuits pour l'entraînement — Kaggle ≈ 30 h/semaine de T4).
3. **Rien d'autre.** Pas de serveur, pas de carte bancaire, pas de PC.

## Feuille de route (chaque étape a son critère d'échec)

1. ✅ **Usine à données** — faite, testée (87 exemples/2 parties, les 11
   catégories représentées, explications lisibles).
2. ⬜ **Dataset v1** — lancer 1-3 runs du workflow (≥ 50 k exemples).
   Vérifier la diversité : niveaux Elo variés, phases variées, ratio
   erreurs/bons coups. Éventuel rééquilibrage (les "book/best" dominent).
3. ⬜ **Fine-tuning v1 (Colab/Kaggle)** — LoRA sur Qwen 1.5B, tâche
   unique et mesurable : *prédire le verdict* d'un coup (à partir de
   fen+san). Critère : nettement mieux que le hasard et qu'une baseline
   naïve ("toujours best"). Si échec → revoir données avant d'élargir.
4. ⬜ **Le test de la métaphore** — même modèle, avec et sans
   verbalisation des observations avant le verdict. Si la verbalisation
   n'améliore rien, la partie "langage comme méthode de réflexion"
   tombe ; on ajuste.
5. ⬜ **v2 pédagogue complet** — génération verdict + explication.
   Évaluation : nos propres yeux + comparaison aux explications
   du pipeline sur des parties jamais vues.
6. ⬜ **L'examen final** — le modèle joue dans le Lab ; précision et Elo
   estimé mesurés par l'outil. (Le cap "puissance" viendra ici.)

## Risques identifiés

- **Confabulation** : le modèle invente des mots plausibles non ancrés →
  contré par l'ancrage systématique dans les faits moteur + l'étape 4.
- **Échelle** : à notre calcul, l'amnésique sera un élève de club, pas un
  grand maître. La *structure* du projet ne dépend pas de l'échelle.
- **Monotonie des explications** : les gabarits actuels sont déterministes ;
  enrichir le générateur de motifs (clouages, fourchettes, colonnes…)
  avant la v2 pour varier la matière.
- **Baby-sitting Colab** : sessions GPU qui expirent → checkpoints
  fréquents, reprise facile.
