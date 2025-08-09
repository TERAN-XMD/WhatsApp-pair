// routers/pair.js
const express = require('express');
const router = express.Router();

const { startPairing } = require('../lib/session');

router.get('/', async (req, res) => {
  const number = req.query.number;
  if (!number) {
    return res.status(400).json({ error: 'Phone number is required. Example: /pair?number=628123456789' });
  }

  // set headers for a streaming/chunked response
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  let codeSent = false;
  let finished = false;

  // if client closes connection (browser navigates away), log it
  req.on('close', () => {
    if (!finished) {
      console.log('Client closed connection before pairing finished');
      // we do not force-cancel startPairing here; it will timeout server-side
    }
  });

  try {
    // startPairing will call onCode(code) as soon as a pairing code is ready
    startPairing(number, (code) => {
      if (!codeSent) {
        codeSent = true;
        // send pairing code as first JSON chunk
        res.write(JSON.stringify({ type: 'code', code }) + '\n');
      }
    }, { timeout: 120000, keepAlive: false })
      .then(({ sessionId, id }) => {
        finished = true;
        // send session result as another chunk then close
        res.write(JSON.stringify({ type: 'session', sessionId, id }) + '\n');
        res.end();
      })
      .catch((err) => {
        finished = true;
        const message = (err && err.message) ? err.message : String(err);
        console.error('Pairing failed:', message);
        res.write(JSON.stringify({ type: 'error', error: message }) + '\n');
        res.end();
      });
  } catch (err) {
    const message = (err && err.message) ? err.message : String(err);
    console.error('Failed to start pairing:', message);
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    } else {
      res.write(JSON.stringify({ type: 'error', error: message }) + '\n');
      res.end();
    }
  }
});

module.exports = router;
