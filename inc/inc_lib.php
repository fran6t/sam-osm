<?php
/**
 * Fonctions utilitaires partagées de SAM : configuration, échappement,
 * chemins vers les assets, et deux vérifications d'environnement destinées à
 * échouer tôt et clairement plutôt que de laisser planter une page plus loin.
 *
 * Volontairement court. L'application n'a ni compte utilisateur, ni session,
 * ni upload (§11 du cahier de conception) : tout ce qui touchait à
 * l'authentification n'a pas lieu d'être ici.
 *
 * Entrées  : inc/inc_config.php (+ surcharge inc_config_perso.php).
 * Sorties  : les fonctions ci-dessous, utilisables depuis n'importe quelle page.
 * Dépend   : PHP 8+, extension pdo_sqlite.
 */

/** Retourne la configuration de l'application (chargée une seule fois). */
function config(): array
{
    static $config = null;
    if ($config === null) {
        require __DIR__ . '/inc_config.php'; // définit $config
    }
    return $config;
}

/** Échappement HTML pour l'affichage dans les templates. */
function e(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
}

/** Construit le chemin public vers un fichier de assets/. */
function asset(string $path): string
{
    return rtrim(config()['base_url'], '/') . '/assets/' . ltrim($path, '/');
}

/**
 * Vérifie les extensions PHP indispensables. La liste est courte à dessein :
 * SAM ne fait ni image ni PDF, seul le cache SQLite du proxy a besoin d'une
 * extension particulière. Appelée une seule fois par requête.
 */
function checkRequirements(): void
{
    static $checked = false;
    if ($checked) {
        return;
    }
    $checked = true;

    $manquantes = [];
    foreach (['pdo_sqlite'] as $ext) {
        if (!extension_loaded($ext)) {
            $manquantes[] = $ext;
        }
    }

    if ($manquantes) {
        http_response_code(500);
        $liste = e(implode(', ', $manquantes));
        exit('Extension(s) PHP requise(s) manquante(s) : ' . $liste
            . '. Installez-la(les) puis rechargez le serveur '
            . '(ex : sudo apt install php-sqlite3 && sudo systemctl reload apache2).');
    }
}

/**
 * Vérifie que le cache SQLite peut être écrit. Sur un hébergement mutualisé
 * comme sur un partage réseau, les droits Unix du dossier bddsam/ sont la
 * cause d'erreur la plus fréquente à l'installation ; autant la nommer.
 * Silencieux si tout est en ordre.
 */
function checkPermissions(): void
{
    static $checked = false;
    if ($checked) {
        return;
    }
    $checked = true;

    $db = config()['db'];
    if (($db['driver'] ?? null) !== 'sqlite') {
        return;
    }

    $probleme = null;
    $dbDir = dirname($db['path']);
    if (!is_dir($dbDir) || !is_writable($dbDir)) {
        $probleme = "dossier du cache non accessible en écriture : $dbDir";
    } elseif (file_exists($db['path']) && !is_writable($db['path'])) {
        $probleme = "fichier de cache non accessible en écriture : {$db['path']}";
    }

    if ($probleme !== null) {
        http_response_code(500);
        exit('Problème de droits détecté : ' . e($probleme)
            . "\nVérifiez les permissions Unix (utilisateur/groupe du serveur web) sur ce chemin.");
    }
}
