
// lib/session.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const pino = require('pino');
const { TERAN_BRAND } = require('./branding');
const { giftedId, removeFile } = require('./index');

const SESSIONS_API_URL = process.env.SESSIONS_API_URL;
const SESSIONS_API_KEY = process.env.SESSIONS_API_KEY;

const {
    default: TERAN_XMD,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers
} = require("@whiskeysockets/baileys");

async function uploadCreds(id) {
    try {
        const authPath = path.join(__dirname, '..', 'temp', id, 'creds.json');
        if (!fs.existsSync(authPath)) return null;

        const credsData = JSON.parse(fs.readFileSync(authPath, 'utf8'));
        const credsId = giftedId();

        await axios.post(`${SESSIONS_API_URL}/api/uploadCreds.php`, 
            { credsId, credsData }, 
            { headers: { 'x-api-key': SESSIONS_API_KEY, 'Content-Type': 'application/json' } }
        );

        return credsId;
    } catch (error) {
        console.error('Error uploading credentials:', error.message);
        return null;
    }
}

async function startPairing(number, onCode) {
    const id = giftedId();
    const authDir = path.join(__dirname, '..', 'temp', id);

    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    let client = TERAN_XMD({
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })) },
        printQRInTerminal: false,
        logger: pino({ level: "fatal" }),
        browser: Browsers.macOS("Safari")
    });

    client.ev.on('creds.update', saveCreds);

    if (!client.authState.creds.registered) {
        await delay(1500);
        const code = await client.requestPairingCode(number.replace(/[^0-9]/g, ''));
        if (onCode) onCode(code);
    }

    client.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
            const sessionId = await uploadCreds(id);
            if (sessionId) {
                await client.sendMessage(client.user.id, { text: sessionId });
                await client.sendMessage(client.user.id, { text: TERAN_BRAND });
            }
            await delay(200);
            await client.ws.close();
            await removeFile(authDir);
        }

        if (connection === "close") {
            const reason = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.message;
            console.log(`Connection closed: ${reason}, retrying...`);
            await delay(3000);
            startPairing(number, onCode);
        }
    });

    return client;
}

module.exports = { startPairing };
