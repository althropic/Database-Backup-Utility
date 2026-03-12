const https = require('https');
const http = require('http');

/**
 * Notification provider for Slack integration
 */
class SlackNotifier {
  constructor(config = {}) {
    this.webhookUrl = config.webhookUrl;
    this.channel = config.channel;
    this.username = config.username || 'Database Backup Utility';
    this.enabled = config.enabled !== false && !!this.webhookUrl;
  }

  /**
   * Send notification to Slack
   */
  async send(message, options = {}) {
    if (!this.enabled) {
      return { success: false, message: 'Slack notifications are disabled' };
    }

    const payload = {
      channel: this.channel,
      username: this.username,
      text: message,
      ...options
    };

    return new Promise((resolve, reject) => {
      const url = new URL(this.webhookUrl);
      const protocol = url.protocol === 'https:' ? https : http;

      const data = JSON.stringify(payload);

      const requestOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      };

      const req = protocol.request(requestOptions, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, statusCode: res.statusCode });
          } else {
            reject(new Error(`Slack API error: ${res.statusCode} ${responseData}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.write(data);
      req.end();
    });
  }

  /**
   * Send backup started notification
   */
  async notifyBackupStart(options) {
    const { databaseType, databaseName, backupType } = options;
    
    const message = `🔄 *Backup Started*\n` +
      `Database: ${databaseName}\n` +
      `Type: ${databaseType}\n` +
      `Backup Type: ${backupType || 'Full'}`;

    return await this.send(message);
  }

  /**
   * Send backup completed notification
   */
  async notifyBackupComplete(options) {
    const { databaseType, databaseName, filePath, fileSize, duration } = options;
    
    const sizeFormatted = this.formatFileSize(fileSize);
    const durationFormatted = this.formatDuration(duration);

    const message = `✅ *Backup Completed*\n` +
      `Database: ${databaseName}\n` +
      `Type: ${databaseType}\n` +
      `File: ${filePath}\n` +
      `Size: ${sizeFormatted}\n` +
      `Duration: ${durationFormatted}`;

    return await this.send(message, {
      attachments: [{
        color: 'good',
        text: 'Backup operation completed successfully'
      }]
    });
  }

  /**
   * Send backup failed notification
   */
  async notifyBackupError(options) {
    const { databaseType, databaseName, error } = options;
    
    const message = `❌ *Backup Failed*\n` +
      `Database: ${databaseName}\n` +
      `Type: ${databaseType}\n` +
      `Error: ${error}`;

    return await this.send(message, {
      attachments: [{
        color: 'danger',
        text: 'Backup operation failed'
      }]
    });
  }

  /**
   * Send restore started notification
   */
  async notifyRestoreStart(options) {
    const { databaseType, databaseName, filePath } = options;
    
    const message = `🔄 *Restore Started*\n` +
      `Database: ${databaseName}\n` +
      `Type: ${databaseType}\n` +
      `File: ${filePath}`;

    return await this.send(message);
  }

  /**
   * Send restore completed notification
   */
  async notifyRestoreComplete(options) {
    const { databaseType, databaseName, duration } = options;
    
    const durationFormatted = this.formatDuration(duration);

    const message = `✅ *Restore Completed*\n` +
      `Database: ${databaseName}\n` +
      `Type: ${databaseType}\n` +
      `Duration: ${durationFormatted}`;

    return await this.send(message, {
      attachments: [{
        color: 'good',
        text: 'Restore operation completed successfully'
      }]
    });
  }

  /**
   * Send restore failed notification
   */
  async notifyRestoreError(options) {
    const { databaseType, databaseName, error } = options;
    
    const message = `❌ *Restore Failed*\n` +
      `Database: ${databaseName}\n` +
      `Type: ${databaseType}\n` +
      `Error: ${error}`;

    return await this.send(message, {
      attachments: [{
        color: 'danger',
        text: 'Restore operation failed'
      }]
    });
  }

  /**
   * Format file size in human-readable format
   */
  formatFileSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Format duration in human-readable format
   */
  formatDuration(ms) {
    if (ms < 1000) {
      return `${ms}ms`;
    }

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    }

    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }

    return `${seconds}s`;
  }
}

/**
 * Notification manager that supports multiple providers
 */
class NotificationManager {
  constructor(config = {}) {
    this.providers = {};

    if (config.slack) {
      this.providers.slack = new SlackNotifier(config.slack);
    }
  }

  /**
   * Send notification through all providers
   */
  async sendAll(message, options = {}) {
    const results = {};

    for (const [name, provider] of Object.entries(this.providers)) {
      try {
        results[name] = await provider.send(message, options);
      } catch (error) {
        results[name] = { success: false, error: error.message };
      }
    }

    return results;
  }

  /**
   * Notify about backup start
   */
  async notifyBackupStart(options) {
    const results = {};

    for (const [name, provider] of Object.entries(this.providers)) {
      try {
        if (provider.notifyBackupStart) {
          results[name] = await provider.notifyBackupStart(options);
        }
      } catch (error) {
        results[name] = { success: false, error: error.message };
      }
    }

    return results;
  }

  /**
   * Notify about backup completion
   */
  async notifyBackupComplete(options) {
    const results = {};

    for (const [name, provider] of Object.entries(this.providers)) {
      try {
        if (provider.notifyBackupComplete) {
          results[name] = await provider.notifyBackupComplete(options);
        }
      } catch (error) {
        results[name] = { success: false, error: error.message };
      }
    }

    return results;
  }

  /**
   * Notify about backup error
   */
  async notifyBackupError(options) {
    const results = {};

    for (const [name, provider] of Object.entries(this.providers)) {
      try {
        if (provider.notifyBackupError) {
          results[name] = await provider.notifyBackupError(options);
        }
      } catch (error) {
        results[name] = { success: false, error: error.message };
      }
    }

    return results;
  }

  /**
   * Notify about restore start
   */
  async notifyRestoreStart(options) {
    const results = {};

    for (const [name, provider] of Object.entries(this.providers)) {
      try {
        if (provider.notifyRestoreStart) {
          results[name] = await provider.notifyRestoreStart(options);
        }
      } catch (error) {
        results[name] = { success: false, error: error.message };
      }
    }

    return results;
  }

  /**
   * Notify about restore completion
   */
  async notifyRestoreComplete(options) {
    const results = {};

    for (const [name, provider] of Object.entries(this.providers)) {
      try {
        if (provider.notifyRestoreComplete) {
          results[name] = await provider.notifyRestoreComplete(options);
        }
      } catch (error) {
        results[name] = { success: false, error: error.message };
      }
    }

    return results;
  }

  /**
   * Notify about restore error
   */
  async notifyRestoreError(options) {
    const results = {};

    for (const [name, provider] of Object.entries(this.providers)) {
      try {
        if (provider.notifyRestoreError) {
          results[name] = await provider.notifyRestoreError(options);
        }
      } catch (error) {
        results[name] = { success: false, error: error.message };
      }
    }

    return results;
  }

  /**
   * Add a notification provider
   */
  addProvider(name, provider) {
    this.providers[name] = provider;
  }

  /**
   * Remove a notification provider
   */
  removeProvider(name) {
    delete this.providers[name];
  }

  /**
   * Check if any providers are configured
   */
  hasProviders() {
    return Object.keys(this.providers).length > 0;
  }
}

/**
 * Create notification manager instance
 */
const createNotificationManager = (config = {}) => {
  return new NotificationManager(config);
};

module.exports = {
  NotificationManager,
  SlackNotifier,
  createNotificationManager
};