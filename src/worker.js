/**
 * worker.js — Web Worker de calcul.
 *
 * Rôle    : exécuter la projection, l'indexation et l'optimisation hors du
 *           thread principal, pour que la carte reste manipulable pendant le
 *           calcul (§6 du cahier).
 * Entrées : messages postés par assets/js/app.js (voir protocole ci-dessous).
 * Sorties : messages postés en retour.
 * Dépend  : geometry.js, spatial-index.js, optimizer.js (même répertoire).
 *
 * PROTOCOLE
 *   ← { type: 'preparer', obstacles, origine: [lat, lon], zone, tailleCellule }
 *   → { type: 'pret', nbObstacles, dureeMs }
 *
 *   ← { type: 'optimiser', point: [lat, lon], options }
 *   → { type: 'resultat', resultats: [{ latlon, score, obstacles }], dureeMs }
 *   → { type: 'erreur', message }
 *
 * Le worker travaille en mètres ; il ne rend que des [lat, lon], pour que la
 * page n'ait jamais à connaître la projection.
 */

importScripts('geometry.js', 'spatial-index.js', 'optimizer.js');

var projection = null;
var index = null;
var zoneProjetee = null;

/**
 * Le point candidat est-il dans la zone dessinée ? On n'utilise cette
 * contrainte que si une zone a été fournie.
 */
function estDansZone(x, y) {
    if (zoneProjetee === null) {
        return true;
    }
    return pointDansPolygone(x, y, zoneProjetee);
}

self.onmessage = function (evenement) {
    var message = evenement.data;

    try {
        if (message.type === 'preparer') {
            var debutPreparation = Date.now();

            // L'origine du repère local est le centre de la zone : c'est là que
            // l'approximation de la projection est la meilleure.
            projection = creerProjection(message.origine[0], message.origine[1]);

            var obstaclesProjetes = message.obstacles.map(function (o) {
                return projeterObstacle(o, projection);
            });

            index = new IndexSpatial(obstaclesProjetes, message.tailleCellule);

            zoneProjetee = message.zone
                ? message.zone.map(function (p) { return projection.versMetres(p[0], p[1]); })
                : null;

            self.postMessage({
                type: 'pret',
                nbObstacles: obstaclesProjetes.length,
                dureeMs: Date.now() - debutPreparation,
            });
            return;
        }

        if (message.type === 'optimiser') {
            if (index === null) {
                throw new Error('Aucun obstacle chargé : appeler « preparer » d\'abord.');
            }

            var debutCalcul = Date.now();
            var depart = projection.versMetres(message.point[0], message.point[1]);

            // Le bord de la zone est aussi la limite de ce que l'on connaît :
            // le score ne peut pas le dépasser (voir calculerScore()).
            var options = Object.assign({}, message.options || {}, {
                estDansZone: estDansZone,
                bordConnaissance: zoneProjetee,
            });
            var resultats = optimiserIsolement(index, { x: depart[0], y: depart[1] }, options);

            self.postMessage({
                type: 'resultat',
                dureeMs: Date.now() - debutCalcul,
                resultats: resultats.map(function (r) {
                    return {
                        latlon: projection.versLatLon(r.x, r.y),
                        score: r.score,
                        obstacles: r.obstacles,
                    };
                }),
            });
            return;
        }

        throw new Error('Message inconnu : ' + message.type);
    } catch (erreur) {
        self.postMessage({ type: 'erreur', message: erreur.message });
    }
};
