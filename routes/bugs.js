'use strict';

const express = require('express');
const router = express.Router();
const bugManager = require('../bug-manager');

// GET /api/bugs — Retrieve all bug reports
router.get('/', (req, res) => {
    res.json({ success: true, bugs: bugManager.getAllBugs() });
});

// POST /api/bugs — Submit a new bug report
router.post('/', (req, res) => {
    const description = (req.body.description || '').trim();
    if (!description) {
        return res.status(400).json({ success: false, error: 'Description is required' });
    }
    const newBug = bugManager.createBug({
        description,
        category: req.body.category,
        reporterName: req.body.reporterName,
        discordId: req.body.discordId,
        discordTag: req.body.discordTag,
        tornId: req.body.tornId,
        tornName: req.body.tornName
    });
    res.json({ success: true, bug: newBug });
});

// POST /api/bugs/:id/status — Update status of a bug report
router.post('/:id/status', (req, res) => {
    const bugId = String(req.params.id || '').trim();
    const bug = bugManager.updateBugStatus(bugId, req.body.status, req.body.resolutionNotes);
    if (!bug) return res.status(404).json({ success: false, error: 'Bug report not found' });
    res.json({ success: true, bug });
});

// DELETE /api/bugs/:id — Delete a bug report
router.delete('/:id', (req, res) => {
    const bugId = String(req.params.id || '').trim();
    const success = bugManager.deleteBug(bugId);
    if (!success) return res.status(404).json({ success: false, error: 'Bug report not found' });
    res.json({ success: true });
});

module.exports = router;
