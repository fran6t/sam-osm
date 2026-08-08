/**
 * geometry.js — primitives géométriques de SAM.
 *
 * Rôle    : convertir des coordonnées géographiques en mètres, et mesurer la
 *           distance d'un point à une géométrie (point, ligne, polygone).
 * Entrées : des couples [latitude, longitude] en degrés, et des obstacles au
 *           format interne (voir normaliserObstacle()).
 * Sorties : des distances en MÈTRES, toujours.
 * Dépend  : rien. Chargé aussi bien par la page (<script>) que par le Web
 *           Worker (importScripts) — donc pas de module ES, pas d'export.
 *
 * ------------------------------------------------------------------
 * POURQUOI UNE PROJECTION LOCALE
 * ------------------------------------------------------------------
 * Une latitude et une longitude sont des ANGLES. Les soustraire comme des
 * mètres est faux : à 45° de latitude, un degré de longitude vaut environ
 * 78,8 km alors qu'un degré de latitude en vaut 111,2. Traiter lat/lon comme
 * un plan cartésien écraserait donc les distances est-ouest de ~30 % ici, et
 * de ~50 % en Laponie.
 *
 * On projette donc une fois pour toutes les coordonnées en mètres, dans un
 * repère plan local centré sur la zone étudiée (projection équirectangulaire
 * locale, dite « plate-carrée locale ») :
 *
 *     x = R × (lon − lon0) × cos(lat0)      (est,  en mètres)
 *     y = R × (lat − lat0)                  (nord, en mètres)
 *
 * HYPOTHÈSE : la zone est petite. Le facteur cos(lat0) est figé à la latitude
 * de référence alors qu'il varie en réalité avec la latitude. L'erreur reste
 * inférieure à ~0,1 % tant que la zone ne dépasse pas ~100 km d'étendue
 * nord-sud, ce que le proxy garantit (config 'limites.surface_max_km2').
 * C'est très en deçà de l'incertitude des données OSM elles-mêmes.
 *
 * En échange, tout le reste du moteur travaille dans un plan euclidien
 * ordinaire : une distance point-segment redevient de la géométrie de lycée,
 * rapide et vérifiable, au lieu de trigonométrie sphérique.
 */

/** Rayon moyen de la Terre (sphère IUGG), en mètres. */
var RAYON_TERRE_M = 6371008.8;

/**
 * Crée un convertisseur entre degrés et mètres, centré sur (latRef, lonRef).
 * Le point de référence devient l'origine (0, 0) du repère local.
 *
 * Exemple : à Paris (48.85, 2.35), un décalage de +0.001° de latitude donne
 *   creerProjection(48.85, 2.35).versMetres(48.851, 2.35)  →  ~[0, 111.2]
 */
function creerProjection(latRef, lonRef) {
    var metresParDegreLat = (Math.PI / 180) * RAYON_TERRE_M;
    var metresParDegreLon = metresParDegreLat * Math.cos((latRef * Math.PI) / 180);

    return {
        latRef: latRef,
        lonRef: lonRef,

        /** [lat, lon] en degrés → [x, y] en mètres. */
        versMetres: function (lat, lon) {
            return [(lon - lonRef) * metresParDegreLon, (lat - latRef) * metresParDegreLat];
        },

        /** [x, y] en mètres → [lat, lon] en degrés. */
        versLatLon: function (x, y) {
            return [latRef + y / metresParDegreLat, lonRef + x / metresParDegreLon];
        },
    };
}

/** Distance entre deux points du plan local, en mètres. */
function distancePointPoint(ax, ay, bx, by) {
    var dx = bx - ax;
    var dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Distance d'un point P au SEGMENT [AB] (et non à la droite qui le porte).
 *
 * On projette P sur AB en calculant t, sa position le long du segment :
 * t = 0 en A, t = 1 en B. On borne t à [0, 1] : si la projection tombe en
 * dehors du segment, le point le plus proche est l'extrémité correspondante.
 * C'est ce bornage qui distingue « distance au segment » de « distance à la
 * droite », et c'est exactement ce qu'on veut pour un tronçon de route.
 *
 * Exemple : distancePointSegment(0, 5, 0, 0, 10, 0) → 5   (au-dessus du milieu)
 *           distancePointSegment(-3, 0, 0, 0, 10, 0) → 3  (au-delà de A)
 */
function distancePointSegment(px, py, ax, ay, bx, by) {
    var abx = bx - ax;
    var aby = by - ay;
    var longueurCarree = abx * abx + aby * aby;

    // Segment dégénéré (A et B confondus) : on retombe sur une distance point-point.
    if (longueurCarree === 0) {
        return distancePointPoint(px, py, ax, ay);
    }

    var t = ((px - ax) * abx + (py - ay) * aby) / longueurCarree;
    t = Math.max(0, Math.min(1, t));

    return distancePointPoint(px, py, ax + t * abx, ay + t * aby);
}

/**
 * Distance d'un point à une polyligne (suite de segments) : le minimum sur
 * tous les segments. Une route OSM est une polyligne, pas un point : c'est
 * cette fonction qui évite de mesurer la distance au « milieu de la route ».
 */
function distancePointPolyligne(px, py, points) {
    if (points.length === 0) {
        return Infinity;
    }
    if (points.length === 1) {
        return distancePointPoint(px, py, points[0][0], points[0][1]);
    }

    var min = Infinity;
    for (var i = 0; i < points.length - 1; i++) {
        var d = distancePointSegment(px, py, points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
        if (d < min) {
            min = d;
        }
    }
    return min;
}

/**
 * Le point est-il à l'intérieur du polygone ? (algorithme du lancer de rayon)
 *
 * On trace un rayon horizontal vers l'est depuis P et on compte les côtés
 * traversés : un nombre impair signifie « dedans ». L'anneau est une liste de
 * sommets ; il n'a pas besoin d'être explicitement refermé (on relie le
 * dernier au premier).
 *
 * LIMITE connue et acceptée : un point pile sur une arête peut être classé
 * d'un côté ou de l'autre selon les arrondis. Sans conséquence ici, puisque
 * la distance vaut alors 0 dans les deux cas.
 */
function pointDansPolygone(px, py, anneau) {
    var dedans = false;
    for (var i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
        var xi = anneau[i][0], yi = anneau[i][1];
        var xj = anneau[j][0], yj = anneau[j][1];

        // Le côté [i,j] chevauche-t-il la hauteur de P, et si oui, l'intersection
        // du rayon avec ce côté est-elle à droite de P ?
        var chevauche = (yi > py) !== (yj > py);
        if (chevauche && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
            dedans = !dedans;
        }
    }
    return dedans;
}

/**
 * Distance d'un point au CONTOUR d'un polygone, qu'il soit dedans ou dehors.
 * Le contour est la polyligne fermée : on relie le dernier sommet au premier.
 *
 * Utile dans les deux sens : mesurer la distance au mur d'un bâtiment depuis
 * l'extérieur, ou mesurer depuis l'intérieur d'une zone à quelle distance on
 * se trouve de sa limite.
 */
function distancePointContour(px, py, anneau) {
    var min = Infinity;
    for (var i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
        var d = distancePointSegment(px, py, anneau[j][0], anneau[j][1], anneau[i][0], anneau[i][1]);
        if (d < min) {
            min = d;
        }
    }
    return min;
}

/**
 * Distance d'un point à un polygone plein (un bâtiment, par exemple).
 * Zéro si le point est à l'intérieur : on est alors DANS l'obstacle, pas à
 * une distance de son bord. Sinon, distance au contour.
 */
function distancePointPolygone(px, py, anneau) {
    if (pointDansPolygone(px, py, anneau)) {
        return 0;
    }
    return distancePointContour(px, py, anneau);
}

/**
 * Distance d'un point à un obstacle projeté, quel que soit son type.
 * C'est le seul point d'entrée utilisé par l'optimiseur : il n'a pas à
 * savoir ce qu'il mesure.
 */
function distanceAObstacle(px, py, obstacle) {
    switch (obstacle.type) {
        case 'point':
            return distancePointPoint(px, py, obstacle.pts[0][0], obstacle.pts[0][1]);
        case 'ligne':
            return distancePointPolyligne(px, py, obstacle.pts);
        case 'polygone':
            return distancePointPolygone(px, py, obstacle.pts);
        default:
            return Infinity;
    }
}

/** Rectangle englobant [minX, minY, maxX, maxY] d'une liste de points projetés. */
function boiteEnglobante(points) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < points.length; i++) {
        if (points[i][0] < minX) { minX = points[i][0]; }
        if (points[i][0] > maxX) { maxX = points[i][0]; }
        if (points[i][1] < minY) { minY = points[i][1]; }
        if (points[i][1] > maxY) { maxY = points[i][1]; }
    }
    return [minX, minY, maxX, maxY];
}

/**
 * Convertit un obstacle du format interne (coordonnées géographiques) vers sa
 * forme projetée, prête pour le calcul. Le format interne est décrit au §7 du
 * cahier de conception :
 *
 *   { id, categorie, source, actif, type: 'point'|'ligne'|'polygone',
 *     coords: [[lat, lon], ...] }
 *
 * La forme projetée ajoute 'pts' (mètres) et 'bbox', et ne conserve du reste
 * que ce dont le moteur a besoin pour restituer un résultat lisible.
 */
function projeterObstacle(obstacle, projection) {
    var pts = obstacle.coords.map(function (c) {
        return projection.versMetres(c[0], c[1]);
    });

    return {
        id: obstacle.id,
        categorie: obstacle.categorie,
        libelle: obstacle.libelle || obstacle.categorie,
        type: obstacle.type,
        pts: pts,
        bbox: boiteEnglobante(pts),
    };
}
