/**
 * optimizer.js — recherche du maximum local d'isolement.
 *
 * Rôle    : à partir d'un point approximatif cliqué par l'utilisateur, trouver
 *           la position voisine la plus éloignée de tout obstacle.
 * Entrées : un IndexSpatial, un point de départ projeté, des options.
 * Sorties : une liste de résultats triés du plus isolé au moins isolé, chacun
 *           avec son score en mètres et les obstacles qui le limitent.
 * Dépend  : geometry.js, spatial-index.js.
 *
 * ------------------------------------------------------------------
 * CE QU'ON CHERCHE
 * ------------------------------------------------------------------
 * Le score d'une position P est la distance à l'obstacle le plus proche :
 *
 *     score(P) = min( distance(P, obstacle_i) )
 *
 * On cherche le P qui MAXIMISE ce minimum. Intuitivement : pousser le point
 * jusqu'au centre du plus grand espace libre du voisinage.
 *
 * ------------------------------------------------------------------
 * POURQUOI UNE RECHERCHE MULTI-RÉSOLUTION
 * ------------------------------------------------------------------
 * Cette fonction de score est en dents de scie : elle a de nombreux maxima
 * locaux (un par « poche » de vide entre les obstacles). Une descente de
 * gradient se coincerait dans la première poche venue, et un balayage fin de
 * tout le voisinage coûterait bien trop cher — un rayon de 2 km au pas de 5 m
 * représente 640 000 positions à évaluer.
 *
 * On procède donc en passes : un balayage grossier repère les bonnes régions,
 * puis on resserre le rayon ET le pas autour de la meilleure position trouvée.
 * Trois passes à 100 m, 20 m puis 5 m coûtent ~2 000 évaluations pour une
 * précision finale de 5 m, soit 300 fois moins.
 *
 * LIMITE ASSUMÉE : la passe grossière peut manquer une poche de vide plus
 * étroite que son pas. C'est le compromis habituel de ce type de recherche, et
 * la raison pour laquelle l'utilisateur reste décisionnaire (§6 du cahier) :
 * on lui propose plusieurs maxima, pas une vérité.
 *
 * Aucune de ces valeurs n'est codée en dur : elles arrivent par 'options'.
 */

var OPTIONS_PAR_DEFAUT = {
    passes: [100, 20, 5],   // pas de balayage successifs, en mètres
    rayonInitial: 2000,     // demi-côté exploré par la passe grossière, en mètres
    nbAlternatives: 3,      // nombre de maxima locaux proposés (§6 du cahier)
    separationMin: 400,     // distance minimale entre deux alternatives, en mètres
    nbObstaclesDetailles: 3, // obstacles listés dans le résultat
    estDansZone: null,      // function(x, y) → bool, ou null si pas de contrainte
    bordConnaissance: null, // contour projeté au-delà duquel on ne sait rien
};

/**
 * Score d'isolement d'une position : la distance à l'obstacle le plus proche,
 * PLAFONNÉE par la distance au bord de ce qu'on a réellement examiné.
 *
 * ------------------------------------------------------------------
 * POURQUOI CE PLAFOND
 * ------------------------------------------------------------------
 * Les obstacles ne sont connus qu'à l'intérieur de la zone étudiée. Sans
 * précaution, un point collé au bord obtient donc un score magnifique — non
 * parce qu'il est isolé, mais parce qu'on n'a pas regardé de l'autre côté. Le
 * calcul se réfugie alors systématiquement dans les coins, et propose des
 * emplacements qui peuvent longer une autoroute située dix mètres plus loin,
 * hors zone.
 *
 * On ne peut honnêtement certifier un isolement que jusqu'à la limite de ce
 * qu'on a examiné : le score est donc borné par la distance à cette limite.
 * Un cercle d'isolement ne déborde ainsi jamais de la zone, et sa taille
 * signifie ce qu'elle prétend signifier.
 *
 * En V1, la limite de connaissance ne sera plus la zone dessinée mais
 * l'emprise, plus large, sur laquelle les données OSM auront été chargées.
 */
function calculerScore(index, x, y, bordConnaissance) {
    var score = index.distanceMinimale(x, y);

    if (bordConnaissance) {
        score = Math.min(score, distancePointContour(x, y, bordConnaissance));
    }

    return score;
}

/**
 * Balaye une grille carrée centrée sur (cx, cy) et retourne les positions
 * évaluées, chacune avec son score. Le centre est toujours évalué, même si le
 * pas ne retombe pas dessus.
 */
function balayer(index, cx, cy, rayon, pas, estDansZone, bordConnaissance) {
    var candidats = [];
    var nbPas = Math.floor(rayon / pas);

    for (var i = -nbPas; i <= nbPas; i++) {
        for (var j = -nbPas; j <= nbPas; j++) {
            var x = cx + i * pas;
            var y = cy + j * pas;

            // Hors de la zone dessinée, on ne sait rien des obstacles : proposer
            // un point là-bas serait malhonnête (§19 du cahier).
            if (estDansZone && !estDansZone(x, y)) {
                continue;
            }

            candidats.push({ x: x, y: y, score: calculerScore(index, x, y, bordConnaissance) });
        }
    }
    return candidats;
}

/**
 * Affine une position par passes successives : à chaque passe, on rebalaye un
 * voisinage plus petit et plus fin autour de la meilleure position connue.
 * Le rayon d'une passe vaut deux fois le pas de la passe précédente : assez
 * large pour rattraper l'imprécision héritée, assez étroit pour rester peu coûteux.
 */
function affiner(index, depart, options) {
    var meilleur = depart;

    for (var p = 1; p < options.passes.length; p++) {
        var pas = options.passes[p];
        var rayon = 2 * options.passes[p - 1];

        var candidats = balayer(index, meilleur.x, meilleur.y, rayon, pas, options.estDansZone, options.bordConnaissance);
        for (var i = 0; i < candidats.length; i++) {
            if (candidats[i].score > meilleur.score) {
                meilleur = candidats[i];
            }
        }
    }

    return meilleur;
}

/**
 * Choisit jusqu'à nbAlternatives graines parmi les candidats, en imposant une
 * distance minimale entre elles.
 *
 * Sans cette précaution, les meilleurs candidats bruts seraient tous voisins
 * les uns des autres (le sommet d'une même colline) et l'on proposerait trois
 * fois le même endroit sous trois noms différents. On veut des poches de vide
 * DISTINCTES.
 */
function choisirGraines(candidats, nbVoulu, separationMin) {
    var tries = candidats.slice().sort(function (a, b) { return b.score - a.score; });
    var graines = [];

    for (var i = 0; i < tries.length && graines.length < nbVoulu; i++) {
        var tropProche = false;
        for (var g = 0; g < graines.length; g++) {
            if (distancePointPoint(tries[i].x, tries[i].y, graines[g].x, graines[g].y) < separationMin) {
                tropProche = true;
                break;
            }
        }
        if (!tropProche) {
            graines.push(tries[i]);
        }
    }

    return graines;
}

/**
 * Point d'entrée de l'optimisation.
 *
 * @param {IndexSpatial} index
 * @param {{x:number, y:number}} depart  point approximatif cliqué, projeté
 * @param {object} optionsAppelant       surcharge de OPTIONS_PAR_DEFAUT
 * @returns {Array} résultats triés par score décroissant :
 *          [{ x, y, score, obstacles: [{ libelle, categorie, distance }] }]
 */
function optimiserIsolement(index, depart, optionsAppelant) {
    var options = Object.assign({}, OPTIONS_PAR_DEFAUT, optionsAppelant || {});

    // Passe grossière : où sont les régions prometteuses ?
    var candidats = balayer(
        index,
        depart.x,
        depart.y,
        options.rayonInitial,
        options.passes[0],
        options.estDansZone,
        options.bordConnaissance
    );

    // Le point cliqué lui-même est toujours un candidat valable : il peut être
    // meilleur que tout ce que la grille a échantillonné autour de lui.
    if (!options.estDansZone || options.estDansZone(depart.x, depart.y)) {
        candidats.push({
            x: depart.x,
            y: depart.y,
            score: calculerScore(index, depart.x, depart.y, options.bordConnaissance),
        });
    }

    if (candidats.length === 0) {
        return []; // rien d'explorable : le clic était hors de la zone étudiée
    }

    var graines = choisirGraines(candidats, options.nbAlternatives, options.separationMin);

    var resultats = graines.map(function (graine) {
        var affine = affiner(index, graine, options);

        var limitants = index.plusProches(affine.x, affine.y, options.nbObstaclesDetailles)
            .map(function (p) {
                return {
                    libelle: p.obstacle.libelle,
                    categorie: p.obstacle.categorie,
                    distance: p.distance,
                };
            });

        // Le bord de la zone est présenté comme un élément limitant à part
        // entière : quand c'est lui qui borne le score, l'utilisateur doit le
        // savoir. Cela signifie « élargissez la zone », pas « c'est isolé ».
        if (options.bordConnaissance) {
            limitants.push({
                libelle: 'Bord de la zone étudiée (au-delà, aucune donnée)',
                categorie: 'limite',
                distance: distancePointContour(affine.x, affine.y, options.bordConnaissance),
            });
            limitants.sort(function (a, b) { return a.distance - b.distance; });
            limitants.length = Math.min(limitants.length, options.nbObstaclesDetailles);
        }

        return {
            x: affine.x,
            y: affine.y,
            score: affine.score,
            obstacles: limitants,
        };
    });

    // L'affinage peut réordonner les résultats : une graine moins bien classée
    // au départ peut mener à un meilleur maximum.
    resultats.sort(function (a, b) { return b.score - a.score; });

    return resultats;
}
