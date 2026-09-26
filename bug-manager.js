'use strict';

const fs = require('fs');
const path = require('path');

const BUGS_FILE = path.join(__dirname, 'data', 'bugs.json');
let onSaveCallback = null;

function setMongoSaveCallback(cb) {
    onSaveCallback = cb;
}

function loadBugs() {
    try {
        if (!fs.existsSync(path.dirname(BUGS_FILE))) {
            fs.mkdirSync(path.dirname(BUGS_FILE), { recursive: true });
        }
        if (fs.existsSync(BUGS_FILE)) {
            const raw = fs.readFileSync(BUGS_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
        }
    } catch (e) {
        console.warn('[BugManager] Error reading bugs.json:', e.message);
    }
    return [];
}

let bugsMemory = loadBugs();

function saveBugs(data) {
    try {
        if (!fs.existsSync(path.dirname(BUGS_FILE))) {
            fs.mkdirSync(path.dirname(BUGS_FILE), { recursive: true });
        }
        fs.writeFileSync(BUGS_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.warn('[BugManager] Error saving bugs.json:', e.message);
    }
    if (typeof onSaveCallback === 'function') {
        try { onSaveCallback(); } catch(e) {}
    }
}

function getAllBugs() {
    return bugsMemory;
}

function createBug({ description, category, reporterName, discordId, discordTag, tornId, tornName }) {
    const bugId = `BUG-${Date.now().toString(36).slice(-5).toUpperCase()}`;
    const newBug = {
        id: bugId,
        description: (description || '').trim(),
        category: (category || 'General / Other').trim(),
        status: 'Open',
        reportedBy: {
            discordId: discordId || '',
            discordTag: discordTag || reporterName || 'Web Operative',
            discordName: reporterName || 'Web Operative',
            tornId: tornId ? String(tornId) : '',
            tornName: tornName || ''
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        resolutionNotes: ''
    };
    bugsMemory.unshift(newBug);
    saveBugs(bugsMemory);
    return newBug;
}

function updateBugStatus(bugId, status, resolutionNotes) {
    const bug = bugsMemory.find(b => String(b.id).toUpperCase() === String(bugId).toUpperCase());
    if (!bug) return null;
    if (status) bug.status = status;
    if (resolutionNotes !== undefined) bug.resolutionNotes = resolutionNotes;
    bug.updatedAt = Date.now();
    saveBugs(bugsMemory);
    return bug;
}

function deleteBug(bugId) {
    const idx = bugsMemory.findIndex(b => String(b.id).toUpperCase() === String(bugId).toUpperCase());
    if (idx === -1) return false;
    bugsMemory.splice(idx, 1);
    saveBugs(bugsMemory);
    return true;
}

function setBugsMemory(bugs) {
    if (Array.isArray(bugs)) {
        bugsMemory = bugs;
        saveBugs(bugsMemory);
    }
}

module.exports = {
    getAllBugs,
    createBug,
    updateBugStatus,
    deleteBug,
    setBugsMemory,
    setMongoSaveCallback,
    get bugsMemory() { return bugsMemory; }
};
