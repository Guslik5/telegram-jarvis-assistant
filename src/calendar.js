import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

let calendar = null;

if (CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN) {
  try {
    const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    oAuth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
    calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
    console.log('[CALENDAR] Google Calendar client initialized successfully.');
  } catch (initErr) {
    console.error('[CALENDAR] Init error:', initErr.message);
  }
} else {
  console.log('[CALENDAR] Missing credentials in environment variables.');
}

export async function getCalendarEvents() {
  if (!calendar) {
    console.log('[CALENDAR] Calendar not initialized');
    return null;
  }

  try {
    const now = new Date();
    // 24 hours window around today to handle any timezone offset
    const timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
    const timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();

    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString(),
      timeMax: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });

    console.log('[CALENDAR] Fetched events count:', res.data.items?.length || 0);
    return res.data.items || [];
  } catch (err) {
    console.error('[CALENDAR] Error fetching calendar events:', err.message);
    return null;
  }
}

export async function createCalendarEvent(summary, startTime, endTime, description = '') {
  if (!calendar) {
    return null;
  }

  try {
    const res = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: summary,
        description: description,
        start: { dateTime: startTime },
        end: { dateTime: endTime }
      }
    });

    return res.data;
  } catch (err) {
    console.error('[CALENDAR] Error creating event:', err.message);
    return null;
  }
}
