import notifier from 'node-notifier';
import { debug, warn } from './logger.js';

/**
 * Send a desktop notification. Fire-and-forget — errors are silently swallowed.
 * @param {string} title - Notification title.
 * @param {string} message - Notification body text.
 */
export function notify(title, message) {
  try {
    notifier.notify({
      title,
      message,
      sound: false,
      wait: false,
    });
    debug(`Notification sent: ${title}`);
  } catch (err) {
    warn(`Failed to send notification: ${err.message}`);
  }
}
