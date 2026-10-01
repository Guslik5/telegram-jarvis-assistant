import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

let calendar = null;

if (CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN) {
  const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
  oAuth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
  calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
}

export async function getCalendarEvents(timeMin, timeMax) {
  if (!calendar) {
    return null;
  }

  try {
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin || new Date(new Date().setHours(0, 0, 0, 0)).toISOString(),
      timeMax: timeMax || new Date(new Date().setHours(23, 59, 59, 999)).toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });

    return res.data.items || [];
  } catch (err) {
    console.error('Error fetching calendar events:', err.message);
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
    console.error('Error creating calendar event:', err.message);
    return null;
  }
}
