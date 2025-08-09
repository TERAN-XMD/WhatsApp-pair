// lib/session.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const pino = require('pino');

const { TERAN_BRAND, sessionMessage } = require('./branding');
const { teranId, removeFile } = require('./index');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  Browsers,
  delay,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

const SESSIONS_API_URL = process.env.SESSIONS_API_URL;
const SESSIONS_API_KEY = process.env.SESSIONS_API_KEY;

/**
 * Try to upload creds to sessions API. Always return a session id (local fallback).
 * @param {string} id - local temp folder id
 * @returns {Promise<string>} sessionId
 */
async function uploadCreds(id) {
  const localId = teranId();
  try {
    const authPath = path.join(__dirname, '..', 'temp', id, 'creds.json');
    if (!fs.existsSync(authPath)) {
      console.warn('uploadCreds: creds.json not found, returning local id');
      return localId;
    }

    const credsData = JSON.parse(fs.readFileSync(authPath, 'utf8'));

    await axios.post(
      `${SESSIONS_API_URL}/api/uploadCreds.php`,
      { credsId: localId, credsData },
      {
        headers: {
          'x-api-key': SESSIONS_API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 8000
      }
    );

    return localId;
  } catch (err) {
    console.warn('uploadCreds: upload failed, returning local id:', err.message);
    return localId;
  }
}

/**
 * Start pairing process for a phone number.
 * - onCode(code) will be called when the pairing code is available
 * - returns a Promise that resolves to { sessionId, id } when pairing finishes
 *
 * options:
 *   - timeout: ms to wait before aborting (default 120000)
 *   - keepAlive: boolean, if true keep socket connected after pairing (default false)
 */
function startPairing(number, onCode = null, options = {}) {
  const timeoutMs = options.timeout ?? 120000;
  const keepAlive = options.keepAlive ?? false;

  return new Promise(async (resolve, reject) => {
    const id = teranId();
    const authDir = path.join(__dirname, '..', 'temp', id);

    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

    let finished = false;
    let timeoutHandle;

    function finish(err, result) {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutHandle);
      if (err) return reject(err);
      return resolve(result);
    }

    // safety timeout
    timeoutHandle = setTimeout(() => {
      finish(new Error('Pairing timeout'));
    }, timeoutMs);

    try {
      const { state, saveCreds } = await useMultiFileAuthState(authDir);

      const client = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'fatal' }),
        browser: Browsers.macOS('Safari')
      });

      client.ev.on('creds.update', saveCreds);

      // If not registered - request pairing code
      if (!client.authState.creds.registered) {
        await delay(1000);
        const normalized = ('' + number).replace(/[^0-9]/g, '');
        try {
          const code = await client.requestPairingCode(normalized);
          if (onCode && typeof onCode === 'function') {
            try { onCode(code); } catch (cbErr) { console.warn('onCode callback error:', cbErr.message); }
          }
        } catch (reqErr) {
          // If requestPairingCode errors out early, abort
          finish(new Error('Failed to request pairing code: ' + (reqErr.message || reqErr)));
        }
      }

      client.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        console.log('connection.update ->', connection);

        if (connection === 'open') {
          try {
            // upload creds (returns local id if upload fails)
            const sessionId = await uploadCreds(id);

            // send session id to the paired number (preferred) if possible
            // use the "number@s.whatsapp.net" target or fallback to client.user.id
            const targetJid = ('' + number).replace(/[^0-9]/g, '') + '@s.whatsapp.net';
            try {
              const msg = await client.sendMessage(targetJid, { text: sessionId });
              // quoted branding optionally
              await client.sendMessage(targetJid, { text: TERAN_BRAND }, { quoted: msg });
            } catch (sendErr) {
              // if sending to the number fails, send to the bot's own account
              console.warn('send to target failed, sending to self:', sendErr.message);
              const msg = await client.sendMessage(client.user.id, { text: sessionId });
              await client.sendMessage(client.user.id, { text: TERAN_BRAND }, { quoted: msg });
            }

            if (!keepAlive) {
              // cleanup
              await delay(200);
              await client.ws.close();
              await removeFile(authDir);
            }

            finish(null, { sessionId, id });
          } catch (err) {
            console.error('Error during "open" processing:', err.message || err);
            finish(err);
          }
        }

        if (connection === 'close') {
          const reason = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.message;
          console.log('connection closed', reason);

          if (!keepAlive) {
            // if we are not keeping the socket alive and we haven't finished, fail
            if (!finished) finish(new Error('Connection closed before pairing finished: ' + reason));
            try { await client.ws.close(); } catch (e) {}
            try { await removeFile(authDir); } catch (e) {}
          } else {
            // keepAlive true -> attempt reconnect after short delay
            console.log('keepAlive is true — attempting reconnection in 3s');
            await delay(3000);
            // simple restart logic: create a fresh pairing attempt with same number
            // NOTE: careful to not create recursive infinite loops in extreme failure cases
            startPairing(number, onCode, options).then(res => finish(null, res)).catch(err => finish(err));
          }
        }
      });

    } catch (err) {
      finish(err);
    }
  });
}

module.exports = {
  startPairing,
  uploadCreds
};
