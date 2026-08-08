/**
 * obstacles-demo.js — générateur d'obstacles FICTIFS pour la V0.
 *
 * Rôle    : fabriquer un jeu d'obstacles plausible à l'intérieur de la zone
 *           dessinée, afin de valider l'algorithme d'isolement sans dépendre
 *           d'OpenStreetMap (§20 du cahier : « valider l'algorithme avant
 *           toute complexité OSM »).
 * Entrées : le polygone de la zone, en [lat, lon].
 * Sorties : des obstacles au format interne (§7 du cahier), donc exactement
 *           ce que produira plus tard la normalisation OSM. Le moteur ne verra
 *           aucune différence : c'est tout l'intérêt de la couche de
 *           normalisation.
 * Dépend  : rien.
 *
 * CE FICHIER DISPARAÎTRA (ou deviendra un mode « démo ») en V1, quand les
 * vraies données arriveront via api/ et osm-normalizer.js.
 */

/**
 * Générateur pseudo-aléatoire déterministe (mulberry32).
 *
 * POURQUOI pas Math.random() : à graine égale, on veut le MÊME jeu
 * d'obstacles d'une exécution à l'autre. Sans cela, impossible de comparer
 * deux réglages de l'optimiseur, ni de reproduire un comportement surprenant.
 */
function creerAleatoire(graine) {
    var etat = graine >>> 0;
    return function () {
        etat = (etat + 0x6d2b79f5) >>> 0;
        var t = etat;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Fabrique un jeu d'obstacles fictifs couvrant la zone.
 *
 * @param {Array} zone   polygone [[lat, lon], ...]
 * @param {number} graine
 * @returns {Array} obstacles au format interne
 */
function genererObstaclesFictifs(zone, graine) {
    var hasard = creerAleatoire(graine === undefined ? 42 : graine);

    var latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
    zone.forEach(function (p) {
        latMin = Math.min(latMin, p[0]);
        latMax = Math.max(latMax, p[0]);
        lonMin = Math.min(lonMin, p[1]);
        lonMax = Math.max(lonMax, p[1]);
    });

    var hauteur = latMax - latMin;
    var largeur = lonMax - lonMin;
    var obstacles = [];
    var compteur = 0;

    function identifiant(prefixe) {
        compteur += 1;
        return prefixe + '-' + compteur;
    }

    // Un point au hasard dans la zone, exprimé en fractions (0..1) de la bbox.
    function pointAleatoire() {
        return [latMin + hasard() * hauteur, lonMin + hasard() * largeur];
    }

    // --- Routes : des polylignes qui traversent la zone en zigzaguant. ---
    // Elles partent d'un bord et rejoignent le bord opposé, avec quelques
    // sommets intermédiaires : c'est la forme d'une vraie voie OSM.
    var nbRoutes = 2 + Math.floor(hasard() * 2);
    for (var r = 0; r < nbRoutes; r++) {
        var horizontale = hasard() < 0.5;
        var sommets = [];
        var nbSommets = 5 + Math.floor(hasard() * 4);

        for (var s = 0; s < nbSommets; s++) {
            var avance = s / (nbSommets - 1);          // 0 → 1 d'un bord à l'autre
            var derive = 0.15 + hasard() * 0.7;        // position transversale
            sommets.push(
                horizontale
                    ? [latMin + derive * hauteur, lonMin + avance * largeur]
                    : [latMin + avance * hauteur, lonMin + derive * largeur]
            );
        }

        obstacles.push({
            id: identifiant('route'),
            type: 'ligne',
            categorie: r === 0 ? 'route' : 'chemin',
            libelle: r === 0 ? 'Route départementale (fictive)' : 'Chemin forestier (fictif)',
            source: 'demo',
            actif: true,
            coords: sommets,
        });
    }

    // --- Bâtiments : de petits quadrilatères. ---
    var nbBatiments = 6 + Math.floor(hasard() * 6);
    for (var b = 0; b < nbBatiments; b++) {
        var centre = pointAleatoire();
        var dLat = (0.002 + hasard() * 0.004) * hauteur;
        var dLon = (0.002 + hasard() * 0.004) * largeur;

        obstacles.push({
            id: identifiant('batiment'),
            type: 'polygone',
            categorie: 'batiment',
            libelle: 'Bâtiment (fictif)',
            source: 'demo',
            actif: true,
            coords: [
                [centre[0] - dLat, centre[1] - dLon],
                [centre[0] - dLat, centre[1] + dLon],
                [centre[0] + dLat, centre[1] + dLon],
                [centre[0] + dLat, centre[1] - dLon],
            ],
        });
    }

    // --- Objets ponctuels : pylônes, antennes, abris... ---
    var nbPoints = 4 + Math.floor(hasard() * 5);
    for (var p = 0; p < nbPoints; p++) {
        obstacles.push({
            id: identifiant('point'),
            type: 'point',
            categorie: 'infrastructure',
            libelle: 'Infrastructure ponctuelle (fictive)',
            source: 'demo',
            actif: true,
            coords: [pointAleatoire()],
        });
    }

    return obstacles;
}
