'use strict';

const express = require('express');
const router = express.Router();

/**
 * Fetch marketplace and lowest bazaar listings from Weav3r API for an item.
 */
async function fetchWeav3rMarketplace(itemId) {
    if (!itemId) return null;
    try {
        const res = await fetch(`https://weav3r.dev/api/marketplace/${itemId}`, {
            signal: AbortSignal.timeout(6000),
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        if (res.status === 200) {
            return await res.json();
        }
    } catch (e) {
        console.warn(`[Weav3r.dev] Error fetching marketplace for #${itemId}:`, e.message);
    }
    return null;
}

// GET /api/bazaar/:itemId or /api/bazaar/price/:itemId — Live item market & bazaar pricing
router.get(['/:itemId', '/price/:itemId'], async (req, res) => {
    const { itemId } = req.params;
    if (!itemId) return res.status(400).json({ success: false, error: "Item ID is required" });
    try {
        const data = await fetchWeav3rMarketplace(itemId);
        if (!data) return res.status(404).json({ success: false, error: "Could not fetch marketplace data from Weav3r.dev" });
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
module.exports.fetchWeav3rMarketplace = fetchWeav3rMarketplace;
