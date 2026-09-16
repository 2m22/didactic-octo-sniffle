const GUIDES = {
    alchemy: 'https://www.wowhead.com/guide/midnight/professions/alchemy-overview-trainer-locations-recipes-tools',
    enchanting: 'https://www.wowhead.com/guide/midnight/professions/enchanting-overview-trainer-locations-recipes-tools',
    inscription: 'https://www.wowhead.com/guide/midnight/professions/inscription-overview-trainer-locations-recipes-tools',
    jewelcrafting: 'https://www.wowhead.com/guide/midnight/professions/jewelcrafting-overview-trainer-locations-recipes-tools'
};

export const maxDuration = 60;

const decodeHtml = (value) => value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const extractItems = (html, profession) => {
    const items = new Map();
    const itemLinkPattern = /href=["'](?:https?:\/\/www\.wowhead\.com)?\/item=(\d+)(?:\/[^"']*)?["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = itemLinkPattern.exec(html)) !== null) {
        const itemId = Number(match[1]);
        const name = decodeHtml(match[2]);
        if (!itemId || !name || name.length < 3 || name.length > 160) continue;
        if (/^(Midnight|Enchanting|Alchemy|Inscription|Jewelcrafting|Profession|Guide|Database)/i.test(name)) continue;
        if (!items.has(itemId)) {
            items.set(itemId, {
                id: itemId,
                name,
                itemId,
                profession,
                difficulty: 100,
                sellPrice: 0,
                matCostNormal: 0,
                matCostCheap: 0,
                sellRate: 'Noch nicht geladen',
                multicraftEligible: profession !== 'enchanting'
            });
        }
    }
    return [...items.values()];
};

const fetchText = async (url) => {
    const response = await fetch(url, {
        headers: { 'User-Agent': 'MidnightCraftingDashboard/1.0 recipe catalog' }
    });
    if (!response.ok) throw new Error(`Wowhead HTTP ${response.status}`);
    return response.text();
};

const parseRecipeSpellId = (itemXml) => {
    const match = itemXml.match(/"ti"\s*:\s*(\d+)/i);
    return match ? Number(match[1]) : null;
};

const parseRecipeSpell = (spellHtml) => {
    const difficultyMatch = spellHtml.match(/Difficulty:\s*(\d+)\s+(\d+)\s+(\d+)/i);
    const reagentStart = spellHtml.search(/>\s*Reagents\s*</i);
    const optionalStart = spellHtml.search(/>\s*Optional Reagents\s*</i);
    const reagentEnd = spellHtml.search(/>\s*(?:Optional Reagents|Spell Details)\s*</i);
    const reagentSection = reagentStart >= 0
        ? spellHtml.slice(reagentStart, reagentEnd > reagentStart ? reagentEnd : reagentStart + 12000)
        : '';
    const optionalEnd = spellHtml.search(/>\s*Spell Details\s*</i);
    const optionalSection = optionalStart >= 0
        ? spellHtml.slice(optionalStart, optionalEnd > optionalStart ? optionalEnd : optionalStart + 12000)
        : '';
    const parseReagents = (section) => {
        const reagents = [];
        const reagentPattern = /href=["'](?:https?:\/\/www\.wowhead\.com)?\/item=(\d+)(?:\/[^"']*)?["'][^>]*>([\s\S]*?)<\/a>[\s\S]{0,80}?\((\d+)\)/gi;
        let match;
        while ((match = reagentPattern.exec(section)) !== null) {
            const itemId = Number(match[1]);
            if (!reagents.some(reagent => reagent.itemId === itemId)) {
                reagents.push({ itemId, quantity: Number(match[3]), name: decodeHtml(match[2]) });
            }
        }
        return reagents;
    };
    return {
        recipeID: null,
        difficulty: difficultyMatch ? Number(difficultyMatch[1]) : 100,
        difficultyBreakpoints: difficultyMatch ? difficultyMatch.slice(1).map(Number) : [],
        reagents: parseReagents(reagentSection),
        optionalReagents: parseReagents(optionalSection)
    };
};

const enrichRecipe = async (recipe) => {
    try {
        const itemXml = await fetchText(`https://www.wowhead.com/item=${recipe.itemId}&xml`);
        const recipeID = parseRecipeSpellId(itemXml);
        if (!recipeID) return recipe;
        const spellHtml = await fetchText(`https://www.wowhead.com/spell=${recipeID}?xml`);
        const details = parseRecipeSpell(spellHtml);
        return { ...recipe, recipeID, difficulty: details.difficulty, reagents: details.reagents, optionalReagents: details.optionalReagents };
    } catch {
        return recipe;
    }
};

const enrichInBatches = async (recipes, batchSize = 8) => {
    const enriched = [];
    for (let index = 0; index < recipes.length; index += batchSize) {
        const batch = recipes.slice(index, index + batchSize);
        enriched.push(...await Promise.all(batch.map(enrichRecipe)));
    }
    return enriched;
};

export default async function handler(request, response) {
    if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        return response.status(405).json({ error: 'Only GET is supported.' });
    }

    try {
        const results = await Promise.all(Object.entries(GUIDES).map(async ([profession, url]) => {
            const upstream = await fetch(url, {
                headers: { 'User-Agent': 'MidnightCraftingDashboard/1.0 recipe catalog' }
            });
            if (!upstream.ok) throw new Error(`Wowhead ${profession}: HTTP ${upstream.status}`);
            return extractItems(await upstream.text(), profession);
        }));
        const recipes = await enrichInBatches(results.flat());
        response.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=3600');
        return response.status(200).json({ source: 'Wowhead Midnight profession guides', updatedAt: Date.now(), recipes });
    } catch (error) {
        return response.status(502).json({ error: 'Wowhead recipe catalog unavailable.', detail: error.message });
    }
}
