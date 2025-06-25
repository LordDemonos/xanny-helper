"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEventImageName = getEventImageName;
exports.getImageUrl = getImageUrl;
exports.getEventImageUrl = getEventImageUrl;
exports.testEventImage = testEventImage;
exports.githubImageToDataURI = githubImageToDataURI;
const logger_1 = require("./logger");
/**
 * Image matching utility for Discord events
 * Maps raid event names to appropriate monster images
 */
// Direct monster name mappings (exact matches and abbreviations)
const monsterMappings = {
    // Direct monster matches
    'lord yelinak': 'lord_yelinak',
    'king tormax': 'king_tormax',
    'aow': 'the_avatar_of_war',
    'avatar of war': 'the_avatar_of_war',
    'klandi': 'klandicar',
    'klandicar': 'klandicar',
    'sont': 'sontalak',
    'sontalak': 'sontalak',
    'zlandi': 'zlandicar',
    'zlandicar': 'zlandicar',
    'vindi': 'derakor_the_vindicator',
    'statue': 'the_statue_of_rallos_zek',
    'ltk': 'lendiniara_the_keeper',
    'lendiniara': 'lendiniara_the_keeper',
    'dozekar': 'dozekar_the_cursed',
    'vulak': 'vulak\`aerr',
    'vulak\'aerr': 'vulak\`aerr',
    'vulak`aerr': 'vulak\`aerr',
    'dain': 'dain_frostreaver_iv',
    'tunare': 'tunare',
    'cazic thule': 'cazic_thule',
    'the final arbiter': 'the_final_arbiter',
    // Specific event name mappings
    'halls of testing': 'halls_of_testing',
    'we\'re definitely not planning something mischievous': 'plane_of_mischief',
    'we\'re definitely not planning something mischievous!': 'plane_of_mischief',
    // Zone-based fallbacks
    'plane of fear': 'cazic_thule',
    'sleeper\'s tomb': 'the_final_arbiter',
    'sleeper`s tomb': 'the_final_arbiter',
    'north tov': 'vulak\`aerr',
    'ntov': 'vulak\`aerr',
    'temple of veeshan': 'vulak\`aerr',
    'ring wars': 'dain_frostreaver_iv',
    'plane of growth': 'tunare',
    // Additional ToV monsters for variety
    'aaryonar': 'aaryonar',
    'cekenar': 'cekenar',
    'dagarn': 'dagarn_the_destroyer',
    'eashen': 'eashen_of_the_sky',
    'gozzrem': 'gozzrem',
    'ikatiar': 'ikatiar_the_venom',
    'jorlleag': 'jorlleag',
    'lady mirenilla': 'lady_mirenilla',
    'lady nevederia': 'lady_nevederia',
    'lord feshlak': 'lord_feshlak',
    'lord koi': 'lord_koi_doken',
    'lord kreizenn': 'lord_kreizenn',
    'lord vyemm': 'lord_vyemm',
    'sevalak': 'sevalak',
    'telkorenar': 'telkorenar',
    'zlexak': 'zlexak',
    // Kael Drakkel monsters
    'derakor': 'derakor_the_vindicator',
    'keldor': 'keldor_dek_torek',
    // Velketor's Labyrinth
    'velketor': 'velketor_the_sorcerer',
    // The Wakening Land
    'wuoshi': 'wuoshi',
    // Cobaltscar
    'kelorek': 'kelorek_dar',
    'kelorek`dar': 'kelorek_dar',
    // The Great Divide
    'narandi': 'narandi_the_wretched',
    // Icewell Keep
    'dain frostreaver': 'dain_frostreaver_iv',
    'dain frostreaver iv': 'dain_frostreaver_iv',
    // Plane of Hate
    'innoruuk': 'innoruuk',
    'maestro': 'maestro_of_rancor',
    // Sleeper's Tomb additional monsters
    'hraashna': 'hraashna_the_warder',
    'master of the guard': 'master_of_the_guard',
    'nanzata': 'nanzata_the_warder',
    'the progenitor': 'the_progenitor',
    'tukaarak': 'tukaarak_the_warder',
    'ventani': 'ventani_the_warder',
    // Plane of Growth additional monsters
    'ail': 'ail_the_elder',
    'fayl': 'fayl_everstrong',
    'guardian of takish': 'guardian_of_takish',
    'guardian of tunare': 'guardian_of_tunare',
    'prince thirneg': 'prince_thirneg',
    'rumbleroot': 'rumbleroot',
    'treah': 'treah_greenroot',
    'tunarean': 'tunarean_earthmelder',
    'gleaming sphere': 'a_gleaming_sphere_of_light',
    'keeper of the glades': 'keeper_of_the_glades',
    // North ToV monsters
    'ajorek': 'ajorek_the_crimson_fang',
    'belijor': 'belijor_the_emerald_eye',
    'bryrym': 'bryrym',
    'carx': 'carx_vean',
    'carx`vean': 'carx_vean',
    'gra': 'gra_vloren',
    'gra`vloren': 'gra_vloren',
    'hsrek': 'hsrek',
    'kal': 'kal_vunar',
    'kal`vunar': 'kal_vunar',
    'kedrak': 'kedrak',
    'lurian': 'lurian',
    'mazrien': 'mazrien',
    'nelaarn': 'nelaarn_the_ebon_claw',
    'nir': 'nir_tan',
    'nir`tan': 'nir_tan',
    'vukuz': 'vukuz',
    'wel': 'wel_wnas',
    'wel`wnas': 'wel_wnas',
    'yendilor': 'yendilor_the_cerulean_wing',
    // Flurry Drakes
    'lava defender': 'a_lava_defender',
    'sky defender': 'a_sky_defender',
    'emerald defender': 'an_emerald_defender',
    'onyx defender': 'an_onyx_defender',
    'beldion': 'beldion_icewind',
    'cyndor': 'cyndor_lightningfang',
    'kalkar': 'kalkar_of_the_maelstrom',
    'malteor': 'malteor_flamecaller',
    'quellod': 'quellod_earthspirit',
    'vyldin': 'vyldin_flamereaver',
    'yrrindor': 'yrrindor_emerald_claw',
    'zyerek': 'zyerek_onyxblood'
};
// Default images for when no specific match is found
const defaultImages = {
    raid: 'raids.webp',
    offnight: 'focus.webp'
};
/**
 * Normalizes text for matching (lowercase, removes special chars)
 */
function normalizeText(text) {
    return text.toLowerCase()
        .replace(/[^\w\s]/g, ' ') // Replace special chars with spaces
        .replace(/\s+/g, ' ') // Normalize multiple spaces
        .trim();
}
/**
 * Finds the first matching monster name in the given text
 */
function findFirstMonsterMatch(text) {
    const normalizedText = normalizeText(text);
    // First, try exact matches from the mappings
    for (const [monsterName, imageName] of Object.entries(monsterMappings)) {
        if (normalizedText.includes(monsterName.toLowerCase())) {
            return imageName;
        }
    }
    // If no exact match, try partial matches
    const words = normalizedText.split(' ');
    for (const word of words) {
        if (word.length > 2) { // Only consider words longer than 2 chars
            for (const [monsterName, imageName] of Object.entries(monsterMappings)) {
                if (monsterName.includes(word) || word.includes(monsterName.split(' ')[0])) {
                    return imageName;
                }
            }
        }
    }
    return null;
}
/**
 * Gets the appropriate image name for a Discord event
 */
function getEventImageName(eventTitle, eventDescription, eventType = 'raid') {
    // Combine title and description for searching
    const searchText = `${eventTitle} ${eventDescription || ''}`;
    // Try to find a monster match
    const monsterMatch = findFirstMonsterMatch(searchText);
    if (monsterMatch) {
        return monsterMatch;
    }
    // Fall back to default images
    return defaultImages[eventType];
}
/**
 * Generates a GitHub URL for an image
 */
function getImageUrl(imageName, githubRepo, branch = 'main') {
    return `https://raw.githubusercontent.com/${githubRepo}/${branch}/assets/img/${imageName}.webp`;
}
/**
 * Gets the complete image URL for a Discord event
 */
function getEventImageUrl(eventTitle, eventDescription, eventType = 'raid', githubRepo, branch = 'main') {
    const imageName = getEventImageName(eventTitle, eventDescription, eventType);
    if (!githubRepo) {
        return null; // Return null if no GitHub repo provided
    }
    return getImageUrl(imageName, githubRepo, branch);
}
/**
 * Test function to see what image would be matched for a given event
 */
function testEventImage(eventTitle, eventDescription, eventType = 'raid') {
    const searchText = `${eventTitle} ${eventDescription || ''}`;
    const normalizedText = normalizeText(searchText);
    // Find the first match and what text matched
    for (const [monsterName, imageName] of Object.entries(monsterMappings)) {
        if (normalizedText.includes(monsterName.toLowerCase())) {
            return {
                imageName,
                matchedText: monsterName
            };
        }
    }
    return {
        imageName: defaultImages[eventType]
    };
}
/**
 * Convert a GitHub image URL to a data URI with caching
 */
async function githubImageToDataURI(imageUrl, cacheManager) {
    try {
        // Check cache first
        const cacheKey = `image_data_uri_${Buffer.from(imageUrl).toString('base64')}`;
        const cached = cacheManager.getImageDataURI(cacheKey);
        if (cached && cached.data && cached.timestamp) {
            const ageInDays = (Date.now() - cached.timestamp) / (1000 * 60 * 60 * 24);
            if (ageInDays < 30) {
                logger_1.logger.info(`Using cached data URI for image: ${imageUrl}`);
                return cached.data;
            }
            else {
                logger_1.logger.info(`Cache expired for image: ${imageUrl}, re-fetching...`);
            }
        }
        // Fetch the image from GitHub
        logger_1.logger.info(`Fetching image from GitHub: ${imageUrl}`);
        const response = await fetch(imageUrl);
        if (!response.ok) {
            logger_1.logger.error(`Failed to fetch image from ${imageUrl}: ${response.status} ${response.statusText}`);
            return null;
        }
        const buffer = await response.arrayBuffer();
        const uint8Array = new Uint8Array(buffer);
        // Check file size (Discord limit is 10MB)
        if (uint8Array.length > 10 * 1024 * 1024) {
            logger_1.logger.error(`Image too large: ${imageUrl} (${uint8Array.length} bytes, max 10MB)`);
            return null;
        }
        // Determine MIME type from file extension
        const url = new URL(imageUrl);
        const pathname = url.pathname.toLowerCase();
        let mimeType = 'image/png'; // default
        if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) {
            mimeType = 'image/jpeg';
        }
        else if (pathname.endsWith('.webp')) {
            mimeType = 'image/webp';
        }
        else if (pathname.endsWith('.gif')) {
            mimeType = 'image/gif';
        }
        // Convert to base64
        const base64 = Buffer.from(uint8Array).toString('base64');
        const dataUri = `data:${mimeType};base64,${base64}`;
        // Cache the result
        cacheManager.setImageDataURI(cacheKey, {
            data: dataUri,
            timestamp: Date.now(),
            size: uint8Array.length,
            mimeType: mimeType
        });
        logger_1.logger.info(`Successfully converted image to data URI: ${imageUrl} (${uint8Array.length} bytes, ${mimeType})`);
        return dataUri;
    }
    catch (error) {
        logger_1.logger.error(`Error converting image to data URI: ${imageUrl}`, error);
        return null;
    }
}
//# sourceMappingURL=imageMatcher.js.map