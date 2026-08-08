/**
 * spatial-index.js — index spatial par grille (« spatial hashing »).
 *
 * Rôle    : répondre vite à « quel est l'obstacle le plus proche de ce point ? »
 *           sans comparer le point à tous les obstacles.
 * Entrées : une liste d'obstacles PROJETÉS (voir projeterObstacle()).
 * Sorties : les k obstacles les plus proches d'un point, avec leur distance.
 * Dépend  : geometry.js (distanceAObstacle).
 *
 * ------------------------------------------------------------------
 * POURQUOI, ET COMMENT
 * ------------------------------------------------------------------
 * L'optimisation locale évalue des milliers de positions candidates. En
 * approche naïve, chaque candidat serait comparé à chaque obstacle : sur une
 * zone chargée depuis OSM (facilement 20 000 géométries) et 5 000 candidats,
 * cela ferait 100 millions de calculs de distance. Injouable dans un
 * navigateur.
 *
 * On découpe donc le plan en cellules carrées et on note, pour chaque cellule,
 * quels obstacles peuvent la concerner. Chercher le plus proche voisin revient
 * alors à n'inspecter que les cellules autour du point, en anneaux successifs,
 * et à s'arrêter dès qu'un anneau ne peut plus contenir mieux que ce qu'on a
 * déjà trouvé.
 *
 * COMPROMIS ASSUMÉ : un obstacle est rangé dans toutes les cellules que
 * touche son RECTANGLE ENGLOBANT, pas sa géométrie exacte. Une route en
 * diagonale est donc référencée dans des cellules qu'elle ne traverse pas.
 * C'est faux au sens strict, mais sans danger : l'index ne fait que
 * pré-sélectionner des candidats, la distance réelle est toujours recalculée
 * ensuite. On gagne en simplicité ce qu'on perd en sélectivité.
 */

/**
 * @param {Array}  obstacles      obstacles projetés
 * @param {number} tailleCellule  côté d'une cellule, en mètres
 */
function IndexSpatial(obstacles, tailleCellule) {
    this.obstacles = obstacles;
    this.taille = tailleCellule || 250;
    this.cellules = new Map(); // "cx:cy" → [indices d'obstacles]

    for (var i = 0; i < obstacles.length; i++) {
        this._ranger(i, obstacles[i].bbox);
    }
}

/** Indice de colonne/ligne de la cellule contenant une coordonnée. */
IndexSpatial.prototype._cellule = function (valeur) {
    return Math.floor(valeur / this.taille);
};

/** Range l'obstacle n° i dans toutes les cellules que touche son rectangle. */
IndexSpatial.prototype._ranger = function (i, bbox) {
    var cxMin = this._cellule(bbox[0]);
    var cyMin = this._cellule(bbox[1]);
    var cxMax = this._cellule(bbox[2]);
    var cyMax = this._cellule(bbox[3]);

    for (var cx = cxMin; cx <= cxMax; cx++) {
        for (var cy = cyMin; cy <= cyMax; cy++) {
            var cle = cx + ':' + cy;
            var liste = this.cellules.get(cle);
            if (liste === undefined) {
                liste = [];
                this.cellules.set(cle, liste);
            }
            liste.push(i);
        }
    }
};

/**
 * Les k obstacles les plus proches de (x, y), du plus proche au plus lointain.
 * Retourne [{ obstacle, distance }, ...], éventuellement moins de k éléments
 * s'il y a moins d'obstacles.
 *
 * La recherche procède par anneaux de cellules de plus en plus larges autour
 * du point. On peut s'arrêter dès que l'anneau courant est plus loin que le
 * k-ième meilleur candidat déjà trouvé : par construction, aucun obstacle
 * rangé au-delà ne pourra faire mieux.
 */
IndexSpatial.prototype.plusProches = function (x, y, k) {
    k = k || 1;

    var cxCentre = this._cellule(x);
    var cyCentre = this._cellule(y);
    var dejaVus = new Set();
    var meilleurs = []; // trié par distance croissante, au plus k éléments

    // Nombre d'anneaux au-delà duquel on a forcément balayé toute la grille.
    var rayonMax = this._rayonMaximal(cxCentre, cyCentre);

    for (var r = 0; r <= rayonMax; r++) {
        // Distance minimale garantie entre le point et TOUT ce qui se trouve
        // hors des anneaux 0..r-1. Les anneaux 0..r-1 couvrent un carré de
        // cellules autour de P ; P étant quelque part dans sa propre cellule,
        // le bord de ce carré est au moins à (r-1) cellules de lui.
        // Borne volontairement prudente : mieux vaut un anneau de trop.
        if (r >= 1 && meilleurs.length >= k) {
            var distanceMinimaleAnneau = (r - 1) * this.taille;
            if (distanceMinimaleAnneau > meilleurs[meilleurs.length - 1].distance) {
                break;
            }
        }

        var candidats = this._indicesAnneau(cxCentre, cyCentre, r);
        for (var n = 0; n < candidats.length; n++) {
            var i = candidats[n];
            if (dejaVus.has(i)) {
                continue; // un obstacle occupe souvent plusieurs cellules
            }
            dejaVus.add(i);

            var obstacle = this.obstacles[i];
            var d = distanceAObstacle(x, y, obstacle);

            if (meilleurs.length < k || d < meilleurs[meilleurs.length - 1].distance) {
                meilleurs.push({ obstacle: obstacle, distance: d });
                meilleurs.sort(function (a, b) { return a.distance - b.distance; });
                if (meilleurs.length > k) {
                    meilleurs.length = k;
                }
            }
        }
    }

    return meilleurs;
};

/**
 * Distance à l'obstacle le plus proche, en mètres — c'est le score
 * d'isolement d'une position candidate (§5 du cahier). Infinity si l'index
 * est vide : sans obstacle connu, aucune contrainte.
 */
IndexSpatial.prototype.distanceMinimale = function (x, y) {
    var proches = this.plusProches(x, y, 1);
    return proches.length ? proches[0].distance : Infinity;
};

/** Indices des obstacles rangés dans les cellules de l'anneau de rayon r. */
IndexSpatial.prototype._indicesAnneau = function (cx, cy, r) {
    var resultat = [];
    var self = this;

    function ajouter(x, y) {
        var liste = self.cellules.get(x + ':' + y);
        if (liste !== undefined) {
            resultat.push.apply(resultat, liste);
        }
    }

    if (r === 0) {
        ajouter(cx, cy);
        return resultat;
    }

    // Bords haut et bas de l'anneau (coins compris), puis côtés gauche/droit.
    for (var x = cx - r; x <= cx + r; x++) {
        ajouter(x, cy - r);
        ajouter(x, cy + r);
    }
    for (var y = cy - r + 1; y <= cy + r - 1; y++) {
        ajouter(cx - r, y);
        ajouter(cx + r, y);
    }
    return resultat;
};

/**
 * Rayon d'anneau au-delà duquel la grille entière a été parcourue. Calculé
 * une fois à partir de l'étendue réelle des obstacles : sans cette borne, une
 * recherche dans une zone vide bouclerait indéfiniment.
 */
IndexSpatial.prototype._rayonMaximal = function (cxCentre, cyCentre) {
    if (this._etendue === undefined) {
        var cxMin = Infinity, cyMin = Infinity, cxMax = -Infinity, cyMax = -Infinity;
        var self = this;
        this.cellules.forEach(function (_liste, cle) {
            var parts = cle.split(':');
            var cx = parseInt(parts[0], 10);
            var cy = parseInt(parts[1], 10);
            if (cx < cxMin) { cxMin = cx; }
            if (cx > cxMax) { cxMax = cx; }
            if (cy < cyMin) { cyMin = cy; }
            if (cy > cyMax) { cyMax = cy; }
            return self;
        });
        this._etendue = this.cellules.size ? [cxMin, cyMin, cxMax, cyMax] : null;
    }

    if (this._etendue === null) {
        return 0; // aucun obstacle
    }

    return Math.max(
        Math.abs(cxCentre - this._etendue[0]),
        Math.abs(cxCentre - this._etendue[2]),
        Math.abs(cyCentre - this._etendue[1]),
        Math.abs(cyCentre - this._etendue[3])
    );
};
