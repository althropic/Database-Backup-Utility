const { SlackNotifier, NotificationManager, createNotificationManager } = require('../src/notifications/notifications');

describe('SlackNotifier', () => {
  describe('constructor', () => {
    it('should create instance with webhook URL', () => {
      const notifier = new SlackNotifier({
        webhookUrl: 'https://hooks.slack.com/services/test/webhook'
      });

      expect(notifier.webhookUrl).toBe('https://hooks.slack.com/services/test/webhook');
      expect(notifier.enabled).toBe(true);
    });

    it('should be disabled when no webhook URL provided', () => {
      const notifier = new SlackNotifier({});

      expect(notifier.enabled).toBe(false);
    });

    it('should be disabled when explicitly set to false', () => {
      const notifier = new SlackNotifier({
        webhookUrl: 'https://hooks.slack.com/services/test/webhook',
        enabled: false
      });

      expect(notifier.enabled).toBe(false);
    });

    it('should use custom username', () => {
      const notifier = new SlackNotifier({
        webhookUrl: 'https://hooks.slack.com/services/test/webhook',
        username: 'Custom Bot'
      });

      expect(notifier.username).toBe('Custom Bot');
    });

    it('should default username to Database Backup Utility', () => {
      const notifier = new SlackNotifier({
        webhookUrl: 'https://hooks.slack.com/services/test/webhook'
      });

      expect(notifier.username).toBe('Database Backup Utility');
    });
  });

  describe('formatFileSize', () => {
    it('should format bytes correctly', () => {
      const notifier = new SlackNotifier({});
      expect(notifier.formatFileSize(500)).toBe('500.00 B');
    });

    it('should format kilobytes correctly', () => {
      const notifier = new SlackNotifier({});
      expect(notifier.formatFileSize(1024)).toBe('1.00 KB');
    });

    it('should format megabytes correctly', () => {
      const notifier = new SlackNotifier({});
      expect(notifier.formatFileSize(1048576)).toBe('1.00 MB');
    });

    it('should format gigabytes correctly', () => {
      const notifier = new SlackNotifier({});
      expect(notifier.formatFileSize(1073741824)).toBe('1.00 GB');
    });
  });

  describe('formatDuration', () => {
    it('should format milliseconds correctly', () => {
      const notifier = new SlackNotifier({});
      expect(notifier.formatDuration(500)).toBe('500ms');
    });

    it('should format seconds correctly', () => {
      const notifier = new SlackNotifier({});
      expect(notifier.formatDuration(5000)).toBe('5s');
    });

    it('should format minutes correctly', () => {
      const notifier = new SlackNotifier({});
      expect(notifier.formatDuration(120000)).toBe('2m 0s');
    });

    it('should format hours correctly', () => {
      const notifier = new SlackNotifier({});
      expect(notifier.formatDuration(3665000)).toBe('1h 1m 5s');
    });
  });

  describe('send', () => {
    it('should return early when disabled', async () => {
      const notifier = new SlackNotifier({ enabled: false });
      const result = await notifier.send('test message');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Slack notifications are disabled');
    });
  });
});

describe('NotificationManager', () => {
  describe('constructor', () => {
    it('should create instance without providers', () => {
      const manager = new NotificationManager();

      expect(manager.hasProviders()).toBe(false);
    });

    it('should create Slack provider when config provided', () => {
      const manager = new NotificationManager({
        slack: {
          webhookUrl: 'https://hooks.slack.com/services/test/webhook'
        }
      });

      expect(manager.hasProviders()).toBe(true);
      expect(manager.providers.slack).toBeInstanceOf(SlackNotifier);
    });
  });

  describe('hasProviders', () => {
    it('should return false when no providers', () => {
      const manager = new NotificationManager();
      expect(manager.hasProviders()).toBe(false);
    });

    it('should return true when providers exist', () => {
      const manager = new NotificationManager();
      manager.addProvider('slack', new SlackNotifier({ webhookUrl: 'test' }));
      expect(manager.hasProviders()).toBe(true);
    });
  });

  describe('addProvider', () => {
    it('should add a provider', () => {
      const manager = new NotificationManager();
      const notifier = new SlackNotifier({ webhookUrl: 'test' });
      
      manager.addProvider('slack', notifier);
      
      expect(manager.providers.slack).toBe(notifier);
    });
  });

  describe('removeProvider', () => {
    it('should remove a provider', () => {
      const manager = new NotificationManager();
      const notifier = new SlackNotifier({ webhookUrl: 'test' });
      
      manager.addProvider('slack', notifier);
      manager.removeProvider('slack');
      
      expect(manager.providers.slack).toBeUndefined();
    });
  });

  describe('createNotificationManager', () => {
    it('should create NotificationManager instance', () => {
      const manager = createNotificationManager();
      
      expect(manager).toBeInstanceOf(NotificationManager);
    });
  });
});