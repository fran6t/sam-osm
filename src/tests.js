/**
 * tests.js — vérifications du moteur géométrique.
 *
 * Rôle    : donner des exemples exécutables des primitives et vérifier que
 *           l'index spatial et l'optimiseur répondent comme l'approche naïve.
 * Usage   : node src/tests.js       (aucune dépendance, aucun installateur)
 * Dépend  : geometry.js, spatial-index.js, optimizer.js.
 *
 * Ces fichiers sont des scripts classiques (pas des modules ES) parce qu'ils
 * doivent être chargeables par un Web Worker via importScripts(). On les
 * évalue donc ici dans un contexte partagé, exactement comme le ferait le
 * navigateur — plutôt que d'ajouter un système de modules au projet.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const contexte = vm.createContext({ Math, Map, Set, Object, Infinity, console, isFinite });
for (const fichier of ['geometry.js', 'spatial-index.js', 'optimizer.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, fichier), 'utf8'), contexte, { filename: fichier });
}
const {
    creerProjection, distancePointPoint, distancePointSegment, distancePointPolyligne,
    pointDansPolygone, distancePointPolygone, distancePointContour, distanceAObstacle, projeterObstacle,
    IndexSpatial, optimiserIsolement,
} = contexte;

let echecs = 0;

function verifier(intitule, obtenu, attendu, tolerance = 1e-6) {
    const ok = Math.abs(obtenu - attendu) <= tolerance;
    if (!ok) { echecs++; }
    console.log(`${ok ? '  ok  ' : ' ÉCHEC'} ${intitule}` + (ok ? '' : `  (obtenu ${obtenu}, attendu ${attendu})`));
}

function verifierVrai(intitule, condition) {
    if (!condition) { echecs++; }
    console.log(`${condition ? '  ok  ' : ' ÉCHEC'} ${intitule}`);
}

console.log('\n— Projection locale —');
{
    // À 45° de latitude, un degré de latitude vaut ~111,2 km et un degré de
    // longitude ~78,7 km : c'est précisément l'écart qu'une lecture naïve de
    // lat/lon comme des mètres ferait disparaître.
    const p = creerProjection(45, 5);
    const [, nord] = p.versMetres(46, 5);
    const [est] = p.versMetres(45, 6);
    verifier('1° de latitude ≈ 111 195 m', nord, 111194.9, 1);
    verifier('1° de longitude à 45° ≈ 78 626 m', est, 78626.2, 1);
    verifierVrai('un degré de longitude est plus court qu\'un degré de latitude', est < nord);

    // Aller-retour : on doit retomber sur le point de départ.
    const [lat, lon] = p.versLatLon(...p.versMetres(45.123, 5.456));
    verifier('aller-retour degrés → mètres → degrés (lat)', lat, 45.123, 1e-9);
    verifier('aller-retour degrés → mètres → degrés (lon)', lon, 5.456, 1e-9);
    verifier('le point de référence est l\'origine', distancePointPoint(...p.versMetres(45, 5), 0, 0), 0);
}

console.log('\n— Distances élémentaires —');
{
    verifier('point-point (3,4)', distancePointPoint(0, 0, 3, 4), 5);
    verifier('point-segment, projection au milieu', distancePointSegment(5, 5, 0, 0, 10, 0), 5);
    verifier('point-segment, projection hors segment côté A', distancePointSegment(-3, 0, 0, 0, 10, 0), 3);
    verifier('point-segment, projection hors segment côté B', distancePointSegment(14, 0, 0, 0, 10, 0), 4);
    verifier('point-segment dégénéré (A = B)', distancePointSegment(0, 3, 7, 0, 7, 0), Math.sqrt(58));

    // La distinction segment / droite est le cœur du calcul : sur une droite
    // infinie, ce point serait à 0 ; sur le segment, il est à 4 de l'extrémité.
    verifierVrai('un segment n\'est pas la droite qui le porte', distancePointSegment(14, 0, 0, 0, 10, 0) === 4);

    const route = [[0, 0], [10, 0], [10, 10]];
    verifier('point-polyligne : le minimum sur tous les segments', distancePointPolyligne(12, 5, route), 2);
}

console.log('\n— Polygones —');
{
    const carre = [[0, 0], [10, 0], [10, 10], [0, 10]];
    verifierVrai('un point au centre est dedans', pointDansPolygone(5, 5, carre));
    verifierVrai('un point à l\'extérieur est dehors', !pointDansPolygone(15, 5, carre));
    verifierVrai('un point aligné mais hors du polygone est dehors', !pointDansPolygone(-1, 5, carre));
    verifier('distance nulle si l\'on est DANS le bâtiment', distancePointPolygone(5, 5, carre), 0);
    verifier('sinon, distance au bord le plus proche', distancePointPolygone(13, 5, carre), 3);
    verifier('distance à un coin', distancePointPolygone(13, 14, carre), 5);
}

console.log('\n— Format interne et projection d\'obstacles —');
{
    const projection = creerProjection(45, 5);
    const obstacle = projeterObstacle(
        { id: 'b1', categorie: 'batiment', type: 'polygone', coords: [[45, 5], [45, 5.001], [45.001, 5.001], [45.001, 5]] },
        projection
    );
    verifierVrai('un obstacle projeté porte son rectangle englobant', obstacle.bbox.length === 4);
    verifier('le moteur mesure jusqu\'à la géométrie, pas au centre', distanceAObstacle(0, 0, obstacle), 0);
}

console.log('\n— Index spatial : mêmes réponses que l\'approche naïve —');
{
    // On sème 400 obstacles au hasard, puis on compare l'index à un balayage
    // exhaustif sur 200 points de contrôle. C'est LE test qui compte : l'index
    // n'a le droit d'être rapide que s'il est exact.
    let graine = 12345;
    const hasard = () => (graine = (graine * 1103515245 + 12345) % 2147483648) / 2147483648;

    const obstacles = [];
    for (let i = 0; i < 400; i++) {
        const x = hasard() * 10000;
        const y = hasard() * 10000;
        const type = i % 3 === 0 ? 'point' : (i % 3 === 1 ? 'ligne' : 'polygone');
        const coords = type === 'point'
            ? [[x, y]]
            : (type === 'ligne'
                ? [[x, y], [x + hasard() * 500, y + hasard() * 500], [x + hasard() * 900, y - hasard() * 300]]
                : [[x, y], [x + 40, y], [x + 40, y + 25], [x, y + 25]]);
        obstacles.push({ id: 'o' + i, categorie: 'test', type, pts: coords, bbox: contexte.boiteEnglobante(coords) });
    }

    const index = new IndexSpatial(obstacles, 250);

    let ecarts = 0;
    for (let t = 0; t < 200; t++) {
        const x = hasard() * 10000;
        const y = hasard() * 10000;

        const parIndex = index.distanceMinimale(x, y);
        let naif = Infinity;
        for (const o of obstacles) {
            naif = Math.min(naif, distanceAObstacle(x, y, o));
        }
        if (Math.abs(parIndex - naif) > 1e-9) { ecarts++; }
    }
    verifier('200 points de contrôle, aucun écart avec le calcul exhaustif', ecarts, 0);

    // Le tri des k plus proches doit être croissant et cohérent.
    const proches = index.plusProches(5000, 5000, 3);
    verifierVrai('plusProches rend bien 3 obstacles', proches.length === 3);
    verifierVrai('...triés du plus proche au plus lointain',
        proches[0].distance <= proches[1].distance && proches[1].distance <= proches[2].distance);
    verifierVrai('...dont le premier est celui de distanceMinimale',
        Math.abs(proches[0].distance - index.distanceMinimale(5000, 5000)) < 1e-9);

    // Comparaison directe, et non via verifier() : Infinity - Infinity vaut NaN.
    verifierVrai('index vide : aucune contrainte', new IndexSpatial([], 250).distanceMinimale(0, 0) === Infinity);
}

console.log('\n— Optimiseur —');
{
    // Quatre obstacles ponctuels aux coins d'un carré de 2 km : le point le
    // plus isolé est évidemment le centre, à 1414 m de chacun. Si l'optimiseur
    // ne retrouve pas ça, il ne sert à rien.
    const coins = [[0, 0], [2000, 0], [2000, 2000], [0, 2000]].map((c, i) => ({
        id: 'c' + i, categorie: 'test', libelle: 'coin', type: 'point', pts: [c], bbox: [c[0], c[1], c[0], c[1]],
    }));
    const index = new IndexSpatial(coins, 250);

    const resultats = optimiserIsolement(index, { x: 700, y: 600 }, {
        passes: [100, 20, 5], rayonInitial: 1500, nbAlternatives: 1,
    });

    verifierVrai('un résultat est produit', resultats.length === 1);
    verifier('le point trouvé est le centre du carré (x)', resultats[0].x, 1000, 5);
    verifier('le point trouvé est le centre du carré (y)', resultats[0].y, 1000, 5);
    verifier('son score est la demi-diagonale', resultats[0].score, Math.sqrt(2) * 1000, 5);
    verifierVrai('le résultat est plus isolé que le point de départ',
        resultats[0].score > index.distanceMinimale(700, 600));
    verifierVrai('les obstacles limitants sont listés', resultats[0].obstacles.length > 0);

    // La contrainte de zone doit être respectée : bridé à l'ouest, le meilleur
    // point ne peut plus être le centre.
    const bride = optimiserIsolement(index, { x: 700, y: 600 }, {
        passes: [100, 20, 5], rayonInitial: 1500, nbAlternatives: 1,
        estDansZone: (x) => x <= 500,
    });
    verifierVrai('aucun résultat ne sort de la zone autorisée', bride[0].x <= 500);

    // Départ hors zone et zone vide : on ne doit pas planter, juste ne rien rendre.
    const vide = optimiserIsolement(index, { x: 700, y: 600 }, {
        passes: [100, 20], rayonInitial: 200, estDansZone: () => false,
    });
    verifierVrai('départ hors zone : liste vide plutôt qu\'une erreur', vide.length === 0);
}

console.log('\n— Plafond lié à la limite de connaissance —');
{
    // Un seul obstacle, loin dans un coin, et une zone carrée de 2 km de côté.
    // Sans plafond, le meilleur point serait collé au bord opposé, avec un
    // score énorme tiré du vide que l'on n'a jamais examiné.
    const obstacle = {
        id: 'o', categorie: 'test', libelle: 'poteau', type: 'point',
        pts: [[100, 100]], bbox: [100, 100, 100, 100],
    };
    const index = new IndexSpatial([obstacle], 250);
    const zone = [[0, 0], [2000, 0], [2000, 2000], [0, 2000]];
    const dansZone = (x, y) => pointDansPolygone(x, y, zone);

    const sansPlafond = optimiserIsolement(index, { x: 1000, y: 1000 }, {
        passes: [100, 20], rayonInitial: 1500, nbAlternatives: 1, estDansZone: dansZone,
    });
    const avecPlafond = optimiserIsolement(index, { x: 1000, y: 1000 }, {
        passes: [100, 20], rayonInitial: 1500, nbAlternatives: 1,
        estDansZone: dansZone, bordConnaissance: zone,
    });

    const distanceAuBord = (r) => distancePointContour(r.x, r.y, zone);

    verifierVrai('sans plafond, le résultat se colle au bord', distanceAuBord(sansPlafond[0]) < 50);
    verifierVrai('avec plafond, il s\'en éloigne nettement', distanceAuBord(avecPlafond[0]) > 400);
    verifier('le score ne dépasse jamais la distance au bord',
        Math.min(avecPlafond[0].score, distanceAuBord(avecPlafond[0])), avecPlafond[0].score, 1e-6);
    verifierVrai('le cercle d\'isolement reste donc dans la zone',
        avecPlafond[0].score <= distanceAuBord(avecPlafond[0]) + 1e-6);
    verifierVrai('le bord est nommé parmi les éléments limitants',
        avecPlafond[0].obstacles.some((o) => o.categorie === 'limite'));

    // Le contour se mesure aussi bien de l'intérieur que de l'extérieur.
    verifier('distance au contour depuis l\'intérieur', distancePointContour(1000, 1500, zone), 500);
    verifier('distance au contour depuis l\'extérieur', distancePointContour(1000, 2300, zone), 300);
}

console.log('\n— Alternatives (§6 du cahier) —');
{
    // Deux clairières séparées : l'optimiseur doit proposer deux endroits
    // DISTINCTS, pas deux fois le sommet de la même colline.
    const murs = [];
    for (let x = 0; x <= 6000; x += 50) {
        murs.push({ id: 'm' + x, categorie: 'test', libelle: 'mur', type: 'point', pts: [[x, 0]], bbox: [x, 0, x, 0] });
        murs.push({ id: 'n' + x, categorie: 'test', libelle: 'mur', type: 'point', pts: [[x, 3000]], bbox: [x, 3000, x, 3000] });
    }
    murs.push({ id: 'sep', categorie: 'test', libelle: 'séparation', type: 'ligne',
        pts: [[3000, 0], [3000, 3000]], bbox: [3000, 0, 3000, 3000] });

    const index = new IndexSpatial(murs, 250);
    const resultats = optimiserIsolement(index, { x: 2000, y: 1500 }, {
        passes: [100, 20], rayonInitial: 2800, nbAlternatives: 2, separationMin: 1000,
    });

    verifierVrai('deux alternatives sont proposées', resultats.length === 2);
    verifierVrai('...suffisamment éloignées l\'une de l\'autre',
        distancePointPoint(resultats[0].x, resultats[0].y, resultats[1].x, resultats[1].y) >= 1000);
    verifierVrai('...classées du plus isolé au moins isolé', resultats[0].score >= resultats[1].score);
}

console.log(echecs === 0 ? '\nTout est vert.\n' : `\n${echecs} vérification(s) en échec.\n`);
process.exit(echecs === 0 ? 0 : 1);
