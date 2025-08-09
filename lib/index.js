
// lib/index.js
require('dotenv').config();
const axios = require('axios');
const fs = require('fs').promises;

const SESSIONS_API_URL = process.env.SESSIONS_API_URL;
const SESSIONS_API_KEY = process.env.SESSIONS_API_KEY;

/**
 * Generate a session id with a stable prefix so validator can recognise it.
 * Example: teranxmd~a1Bc2D...
 */
function teranId(length = 22) {
  const prefix = 'teranxmd~';
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;
  let result = '';

  // produce (length - prefix.length) chars, but keep simple semantics
  const target = Math.max(8, length - prefix.length);
  for (let i = 0; i < target; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }

  return `${prefix}${result}`;
}

/**
 * Download credentials JSON from sessions API.
 * Expects sessionId starting with 'teranxmd~'
 */
async function downloadCreds(sessionId) {
  if (!sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('teranxmd~')) {
    throw new Error('Invalid SESSION_ID: must start with "teranxmd~"');
  }

  try {
    const url = `${SESSIONS_API_URL}/api/downloadCreds.php/${encodeURIComponent(sessionId)}`;
    const resp = await axios.get(url, {
      headers: { 'x-api-key': SESSIONS_API_KEY },
      timeout: 10000
    });

    const credsData = resp.data?.credsData;
    if (!credsData) {
      throw new Error('No session data received from sessions API');
    }

    return typeof credsData === 'string' ? JSON.parse(credsData) : credsData;
  } catch (err) {
    console.error('downloadCreds error:', err.response?.data || err.message);
    throw err;
  }
}

/**
 * Remove a file or folder recursively (safe).
 */
async function removeFile(filePath) {
  try {
    await fs.access(filePath);
    await fs.rm(filePath, { recursive: true, force: true });
    return true;
  } catch (err) {
    // ENOENT means file already gone — treat as success
    if (err.code && err.code === 'ENOENT') return false;
    console.error('removeFile error:', err.message);
    return false;
  }
}

module.exports = {
  teranId,
  downloadCreds,
  removeFile
};
