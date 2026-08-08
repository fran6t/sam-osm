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
    maxIterationsMontee: 60, // garde-fou de la montée locale
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
 * Monte du point cliqué vers le maximum local d'isolement, de proche en proche.
 *
 * ------------------------------------------------------------------
 * POURQUOI PARTIR DU POINT, ET NON BALAYER LES ALENTOURS
 * ------------------------------------------------------------------
 * L'utilisateur a une intuition : le relief, la végétation, l'accès, son sujet
 * photographique. Quand il clique, il désigne une POCHE de terrain, pas une
 * région de plusieurs kilomètres. Retenir le meilleur point d'un disque de
 * 2 km revient à lui répondre « j'ai trouvé mieux, à vingt minutes de marche,
 * de l'autre côté de la route » — ce n'est pas la question posée. C'est le
 * mode « chercher dans toute la zone » du §5 du cahier, pas l'optimisation
 * locale du §4.
 *
 * On progresse donc par petits pas : à chaque itération on n'examine qu'un
 * voisinage de deux fois le pas, et on ne se déplace que si l'on gagne. Le
 * point remonte la pente du score et s'arrête au sommet de SA colline. Il ne
 * peut pas enjamber une route pour aller voir ailleurs.
 *
 * Les passes successives (grossière puis fines) servent ici à affiner la
 * position, pas à explorer : le pas diminue, le voisinage examiné aussi.
 */
function monterVersMaximumLocal(index, depart, options) {
    var meilleur = {
        x: depart.x,
        y: depart.y,
        score: calculerScore(index, depart.x, depart.y, options.bordConnaissance),
    };

    for (var p = 0; p < options.passes.length; p++) {
        var pas = options.passes[p];

        for (var iteration = 0; iteration < options.maxIterationsMontee; iteration++) {
            var candidats = balayer(index, meilleur.x, meilleur.y, 2 * pas, pas,
                options.estDansZone, options.bordConnaissance);

            var aProgresse = false;
            for (var i = 0; i < candidats.length; i++) {
                if (candidats[i].score > meilleur.score) {
                    meilleur = candidats[i];
                    aProgresse = true;
                }
            }

            // Plus rien de mieux autour : on est au sommet pour cette échelle.
            if (!aProgresse) {
                break;
            }
        }
    }

    return meilleur;
}

/** Une position est-elle assez éloignée de toutes celles déjà retenues ? */
function assezLoin(position, dejaRetenues, separationMin) {
    for (var i = 0; i < dejaRetenues.length; i++) {
        if (distancePointPoint(position.x, position.y, dejaRetenues[i].x, dejaRetenues[i].y) < separationMin) {
            return false;
        }
    }
    return true;
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
function choisirGraines(candidats, nbVoulu, separationMin, dejaRetenues) {
    var tries = candidats.slice().sort(function (a, b) { return b.score - a.score; });
    var graines = (dejaRetenues || []).slice();
    var nbDepart = graines.length;

    for (var i = 0; i < tries.length && graines.length - nbDepart < nbVoulu; i++) {
        if (assezLoin(tries[i], graines, separationMin)) {
            graines.push(tries[i]);
        }
    }

    return graines.slice(nbDepart);
}

/** Habille une position calculée : score, éléments limitants, provenance. */
function decrire(index, position, options, origine) {
    var limitants = index.plusProches(position.x, position.y, options.nbObstaclesDetailles)
        .map(function (p) {
            return {
                libelle: p.obstacle.libelle,
                categorie: p.obstacle.categorie,
                distance: p.distance,
            };
        });

    // Le bord de la zone est présenté comme un élément limitant à part entière :
    // quand c'est lui qui borne le score, l'utilisateur doit le savoir. Cela
    // signifie « élargissez la zone », pas « c'est isolé ».
    if (options.bordConnaissance) {
        limitants.push({
            libelle: 'Bord de la zone étudiée (au-delà, aucune donnée)',
            categorie: 'limite',
            distance: distancePointContour(position.x, position.y, options.bordConnaissance),
        });
        limitants.sort(function (a, b) { return a.distance - b.distance; });
        limitants.length = Math.min(limitants.length, options.nbObstaclesDetailles);
    }

    return {
        x: position.x,
        y: position.y,
        score: position.score,
        origine: origine, // 'local' = obtenu depuis le point cliqué ; 'alternative' = trouvé ailleurs
        obstacles: limitants,
    };
}

/**
 * Point d'entrée de l'optimisation.
 *
 * Le PREMIER résultat est toujours le maximum local atteint depuis le point
 * cliqué : c'est la réponse à la question posée, et elle reste en tête même si
 * une alternative obtient un meilleur score. Les suivants sont d'autres poches
 * intéressantes repérées dans le voisinage élargi, proposées à titre de
 * comparaison — l'utilisateur reste décisionnaire (§6 du cahier).
 *
 * @param {IndexSpatial} index
 * @param {{x:number, y:number}} depart  point approximatif cliqué, projeté
 * @param {object} optionsAppelant       surcharge de OPTIONS_PAR_DEFAUT
 * @returns {Array} [{ x, y, score, origine, obstacles }]
 */
function optimiserIsolement(index, depart, optionsAppelant) {
    var options = Object.assign({}, OPTIONS_PAR_DEFAUT, optionsAppelant || {});

    // Cliquer hors de la zone n'a pas de sens : on ne sait rien de ce qui s'y
    // trouve. Mieux vaut une liste vide qu'une réponse inventée.
    if (options.estDansZone && !options.estDansZone(depart.x, depart.y)) {
        return [];
    }

    var resultats = [
        decrire(index, monterVersMaximumLocal(index, depart, options), options, 'local'),
    ];

    // Alternatives : on balaye largement autour du départ, on retient des
    // graines bien séparées du résultat local et entre elles, puis on les affine.
    if (options.nbAlternatives > 1) {
        var candidats = balayer(
            index,
            depart.x,
            depart.y,
            options.rayonInitial,
            options.passes[0],
            options.estDansZone,
            options.bordConnaissance
        );

        var graines = choisirGraines(
            candidats,
            options.nbAlternatives - 1,
            options.separationMin,
            resultats
        );

        var alternatives = [];
        graines.forEach(function (graine) {
            var affine = affiner(index, graine, options);
            // L'affinage peut ramener une graine tout près d'un résultat déjà
            // retenu : on ne propose pas deux fois le même endroit.
            if (assezLoin(affine, resultats.concat(alternatives), options.separationMin)) {
                alternatives.push(decrire(index, affine, options, 'alternative'));
            }
        });

        alternatives.sort(function (a, b) { return b.score - a.score; });
        resultats = resultats.concat(alternatives);
    }

    return resultats;
}
