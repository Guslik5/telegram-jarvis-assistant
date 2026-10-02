import { google } from 'googleapis';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

let drive = null;

function initDrive() {
  if (CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN) {
    try {
      const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
      oAuth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
      drive = google.drive({ version: 'v3', auth: oAuth2Client });
      console.log('[DRIVE] Google Drive client initialized successfully from env.');
      return;
    } catch (e) {
      console.error('[DRIVE] Env init error:', e.message);
    }
  }

  // Fallback to local tokens.json if available
  try {
    const userProfile = process.env.USERPROFILE || process.env.HOME || '';
    const keysPath = path.join(userProfile, '.config', 'google-drive-mcp', 'gcp-oauth.keys.json');
    const tokensPath = path.join(userProfile, '.config', 'google-drive-mcp', 'tokens.json');

    if (fs.existsSync(keysPath) && fs.existsSync(tokensPath)) {
      const keys = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
      const clientInfo = keys.installed || keys.web;
      const rawTokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
      const tokens = rawTokens.personal || rawTokens;

      const oAuth2Client = new google.auth.OAuth2(clientInfo.client_id, clientInfo.client_secret);
      oAuth2Client.setCredentials(tokens);
      drive = google.drive({ version: 'v3', auth: oAuth2Client });
      console.log('[DRIVE] Google Drive client initialized from local config.');
    }
  } catch (err) {
    console.error('[DRIVE] Local init error:', err.message);
  }
}

initDrive();

export async function listDriveFiles(limit = 10) {
  if (!drive) initDrive();
  if (!drive) return null;

  try {
    const res = await drive.files.list({
      pageSize: limit,
      q: 'trashed = false',
      fields: 'files(id, name, mimeType, modifiedTime, webViewLink, size)',
      orderBy: 'modifiedTime desc'
    });

    return res.data.files || [];
  } catch (err) {
    console.error('[DRIVE] Error listing files:', err.message);
    return null;
  }
}

export async function searchDriveFiles(term, limit = 10) {
  if (!drive) initDrive();
  if (!drive) return null;

  try {
    const cleanTerm = term.replace(/'/g, "\\'");
    const q = `trashed = false and (name contains '${cleanTerm}' or fullText contains '${cleanTerm}')`;

    const res = await drive.files.list({
      pageSize: limit,
      q: q,
      fields: 'files(id, name, mimeType, modifiedTime, webViewLink, size)',
      orderBy: 'modifiedTime desc'
    });

    return res.data.files || [];
  } catch (err) {
    console.error('[DRIVE] Error searching files:', err.message);
    return null;
  }
}

export async function readDriveFile(fileId) {
  if (!drive) initDrive();
  if (!drive) return null;

  try {
    const meta = await drive.files.get({
      fileId,
      fields: 'id, name, mimeType'
    });

    const mimeType = meta.data.mimeType;

    if (mimeType === 'application/vnd.google-apps.document') {
      const res = await drive.files.export(
        { fileId, mimeType: 'text/plain' },
        { responseType: 'text' }
      );
      return { name: meta.data.name, content: res.data };
    } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      const res = await drive.files.export(
        { fileId, mimeType: 'text/csv' },
        { responseType: 'text' }
      );
      return { name: meta.data.name, content: res.data };
    } else {
      const res = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'text' }
      );
      return { name: meta.data.name, content: typeof res.data === 'string' ? res.data : JSON.stringify(res.data) };
    }
  } catch (err) {
    console.error('[DRIVE] Error reading file:', err.message);
    return null;
  }
}
