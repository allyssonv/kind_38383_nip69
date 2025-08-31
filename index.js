// Import necessary modules
import { SimplePool } from 'nostr-tools/pool';
import WebSocket from 'ws';
import { useWebSocketImplementation } from 'nostr-tools/pool';
import boxen from 'boxen';
import fs from 'fs';
import crypto from 'crypto';

// Enable WebSocket for nostr-tools in Node.js
useWebSocketImplementation(WebSocket);

// Enable strict mode for safer JavaScript
'use strict';

// Constants for configuration
const RELAYS = [
  'wss://nostr.satstralia.com',
  'wss://relay.0xchat.com',
  'wss://relay.damus.io',
  'wss://wot.nostr.party',
  'wss://nostr.wine',
  'wss://relay.snort.social',
  'wss://nos.lol',
  'wss://relay.primal.net'
];

const EVENT_KIND = 38383;
const CURRENCY = 'BRL';
const STATUS = 'pending';
const SOURCE = 'robosats';
const MAX_PREMIUM = 2;
const PROCESSED_EVENTS_FILE = './processed_events.json';

// In-memory cache for processed event IDs and message hashes
let processedEventIds = new Set();
let processedMessageHashes = new Set();

// Load processed event IDs and message hashes from file
const loadProcessedEvents = () => {
  try {
    if (fs.existsSync(PROCESSED_EVENTS_FILE)) {
      const data = fs.readFileSync(PROCESSED_EVENTS_FILE, 'utf8');
      const { events, messages } = JSON.parse(data);
      processedEventIds = new Set(events);
      processedMessageHashes = new Set(messages);
      console.log(`Loaded ${events.length} processed event IDs and ${messages.length} message hashes from file.`);
    }
  } catch (error) {
    console.warn(`Error loading processed events: ${error.message}`);
  }
};

// Save processed event IDs and message hashes to file
const saveProcessedEvents = () => {
  try {
    fs.writeFileSync(
      PROCESSED_EVENTS_FILE,
      JSON.stringify({
        events: [...processedEventIds],
        messages: [...processedMessageHashes],
      }),
      'utf8'
    );
  } catch (error) {
    console.warn(`Error saving processed events: ${error.message}`);
  }
};

// Initialize processed events
loadProcessedEvents();

// Utility function to calculate timestamps for the last 15 days
const getRecentTimestamps = () => {
  const now = new Date();
  const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
  return {
    since: Math.floor(fifteenDaysAgo.getTime() / 1000),
    until: Math.floor(now.getTime() / 1000),
    start: fifteenDaysAgo,
    end: now,
  };
};

// Utility function to format fiat amount (fa)
const formatFiatAmount = (fa) => {
  if (!Array.isArray(fa) || fa.length === 0) return null;
  if (fa.length === 2) {
    return `${parseFloat(fa[0]).toFixed(2)} a ${parseFloat(fa[1]).toFixed(2)}`;
  }
  if (fa.length === 1) {
    return parseFloat(fa[0]).toFixed(2);
  }
  return null;
};

// Utility function to format payment methods (pm)
const formatPaymentMethods = (pm) => (pm.length > 1 ? pm.join(' ou ') : pm[0]);

// Utility function to hash message content
const hashMessage = (message) => {
  return crypto.createHash('sha256').update(message).digest('hex');
};

// Utility function to send notification via ntfy.sh
const sendNotification = async (message, eventId) => {
  const messageHash = hashMessage(message);

  // Check if event ID or message hash has already been processed
  if (processedEventIds.has(eventId) || processedMessageHashes.has(messageHash)) {
    console.log(`Event ${eventId} or message hash ${messageHash} already processed, skipping notification.`);
    return;
  }

  try {
    const response = await fetch('https://ntfy.sh/offers', {
      method: 'POST',
      body: message,
      headers: {'Title': 'Oferta encontrada!', 'Tags': 'rotating_light'}
    });
    if (!response.ok) {
      throw new Error(`Failed to send notification: ${response.statusText}`);
    }
    // Mark event and message as processed
    processedEventIds.add(eventId);
    processedMessageHashes.add(messageHash);
    saveProcessedEvents();
    console.log(`Notification sent for event ${eventId}, message hash ${messageHash}`);
  } catch (error) {
    console.warn(`Notification error for event ${eventId}: ${error.message}`);
  }
};

// Utility function to extract specific tag values
const extractTagValue = (tags, tagName) =>
  tags.find(([name]) => name === tagName)?.slice(1);

// Main function to query Nostr events
const queryNostrEvents = async () => {
  const pool = new SimplePool();

  console.log(boxen('Connecting to Nostr relays...', { padding: 1, borderStyle: 'round' }));

  // Calculate timestamps for the last 15 days
  const { since, until, start, end } = getRecentTimestamps();

  console.log(`Filtering events from: ${start.toLocaleString()} (Unix: ${since})`);
  console.log(`To: ${end.toLocaleString()} (Unix: ${until})`);

  // Define filters
  const filters = {
    kinds: [EVENT_KIND],
    since,
    until,
    '#f': [CURRENCY],
    '#s': [STATUS],
    '#y': [SOURCE],
  };

  console.log('Querying for events with filters:', filters);

  try {
    // Connect to relays
    await Promise.all(
      RELAYS.map(async (relay) => {
        try {
          await pool.ensureRelay(relay);
        } catch (err) {
          console.warn(`Failed to connect to relay ${relay}: ${err.message}`);
        }
      })
    );

    // Fetch events
    const events = await pool.querySync(RELAYS, filters);

    if (!events.length) {
      console.log(`No events found for kind ${EVENT_KIND}, last 15 days, and "${STATUS}" status.`);
      return;
    }

    console.log(boxen(`Found ${events.length} events of kind ${EVENT_KIND}.`, {
      padding: 1,
      borderStyle: 'round',
      borderColor: 'yellow',
    }));

    // Process events
    for (const { tags, id } of events) {
      const fiatAmount = extractTagValue(tags, 'fa');
      const paymentMethods = extractTagValue(tags, 'pm');
      const premium = parseFloat(extractTagValue(tags, 'premium')?.[0] ?? NaN);
      const kind = extractTagValue(tags, 'k')?.[0];

      if (kind !== 'sell' || premium > MAX_PREMIUM || isNaN(premium)) {
        continue;
      }

      if (!fiatAmount || !paymentMethods) {
        console.warn(`Event ${id} skipped: missing required tags (fa or pm)`);
        continue;
      }

      const faFormatted = formatFiatAmount(fiatAmount);
      if (!faFormatted) {
        console.warn(`Event ${id} skipped: invalid fiat amount format`);
        continue;
      }

      const pmFormatted = formatPaymentMethods(paymentMethods);
      const message = `Valor: R$ ${faFormatted}\nPagamento via: ${pmFormatted}\nSpread: ${premium}%`;

      console.log(boxen(message, { title: '💰', titleAlignment: 'center', borderColor: 'green', borderStyle: 'round' }));

      // Send notification with event ID for deduplication
      await sendNotification(message, id);
    }

  } catch (error) {
    console.error('Error querying Nostr events:', error.message);
  } finally {
    console.log(boxen('Closing Nostr relay connections.', { borderColor: 'red', borderStyle: 'round' }));
    try {
      await Promise.all(
        RELAYS.map(async (relay) => {
          try {
            await pool.close([relay]);
          } catch (err) {
            console.warn(`Error closing relay ${relay}: ${err.message}`);
          }
        })
      );
    } catch (err) {
      console.warn('Error closing relay connections:', err.message);
    }
  }
};

// Export and run the function
export { queryNostrEvents };
queryNostrEvents();