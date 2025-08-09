
// routers/pair.js
const express = require('express');
const { startPairing } = require('../lib/session');
const router = express.Router();

router.get('/', async (req, res) => {
    const num = req.query.number;
    if (!num) return res.status(400).json({ error: "Phone number is required" });

    try {
        await startPairing(num, (code) => {
            res.json({ pairingCode: code });
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to start pairing" });
    }
});

module.exports = router;
