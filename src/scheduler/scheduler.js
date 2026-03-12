const cron = require('node-cron');
const { createBackupManager } = require('../database/backup');
const { createNotificationManager } = require('../notifications/notifications');
const { createLogger } = require('../utils/logger');

/**
 * Scheduler for automatic backup operations
 */
class BackupScheduler {
  constructor(config = {}) {
    this.config = config;
    this.jobs = new Map();
    this.logger = config.logger || createLogger();
    this.notificationManager = config.notifications 
      ? createNotificationManager({ slack: config.notifications.slack })
      : null;
  }

  /**
   * Schedule a backup job
   */
  schedule(name, dbConfig, backupOptions, cronExpression) {
    if (!cron.validate(cronExpression)) {
      throw new Error(`Invalid cron expression: ${cronExpression}`);
    }

    // Stop existing job with same name
    if (this.jobs.has(name)) {
      this.stop(name);
    }

    const job = cron.schedule(cronExpression, async () => {
      await this.executeJob(name, dbConfig, backupOptions);
    }, {
      scheduled: true,
      timezone: this.config.timezone || 'UTC'
    });

    this.jobs.set(name, {
      name,
      dbConfig,
      backupOptions,
      cronExpression,
      job,
      createdAt: new Date(),
      lastRun: null,
      nextRun: this.getNextRun(cronExpression),
      lastStatus: null,
      enabled: true
    });

    return {
      name,
      cronExpression,
      nextRun: this.getNextRun(cronExpression)
    };
  }

  /**
   * Execute a backup job
   */
  async executeJob(name, dbConfig, backupOptions) {
    const jobInfo = this.jobs.get(name);
    
    try {
      this.logger.info(`Starting scheduled backup: ${name}`);
      
      // Notify start
      if (this.notificationManager) {
        await this.notificationManager.notifyBackupStart({
          databaseType: dbConfig.type,
          databaseName: dbConfig.database || dbConfig.filePath,
          backupType: backupOptions.type || 'full'
        });
      }

      // Create backup manager and execute backup
      const backupManager = createBackupManager(dbConfig, backupOptions, this.logger);
      const result = await backupManager.performBackup();

      // Update job info
      if (jobInfo) {
        jobInfo.lastRun = new Date();
        jobInfo.lastStatus = 'success';
        jobInfo.lastResult = result;
        jobInfo.nextRun = this.getNextRun(jobInfo.cronExpression);
      }

      // Notify completion
      if (this.notificationManager) {
        await this.notificationManager.notifyBackupComplete({
          databaseType: dbConfig.type,
          databaseName: dbConfig.database || dbConfig.filePath,
          filePath: result.filePath,
          fileSize: result.fileSize,
          duration: result.duration
        });
      }

      this.logger.info(`Scheduled backup completed: ${name}`, result);

      return result;

    } catch (error) {
      // Update job info
      if (jobInfo) {
        jobInfo.lastRun = new Date();
        jobInfo.lastStatus = 'error';
        jobInfo.lastError = error.message;
      }

      // Notify error
      if (this.notificationManager) {
        await this.notificationManager.notifyBackupError({
          databaseType: dbConfig.type,
          databaseName: dbConfig.database || dbConfig.filePath,
          error: error.message
        });
      }

      this.logger.error(`Scheduled backup failed: ${name}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Stop a scheduled job
   */
  stop(name) {
    const jobInfo = this.jobs.get(name);
    
    if (jobInfo) {
      jobInfo.job.stop();
      jobInfo.enabled = false;
      return true;
    }
    
    return false;
  }

  /**
   * Start a stopped job
   */
  start(name) {
    const jobInfo = this.jobs.get(name);
    
    if (jobInfo) {
      jobInfo.job.start();
      jobInfo.enabled = true;
      return true;
    }
    
    return false;
  }

  /**
   * Remove a scheduled job
   */
  remove(name) {
    if (this.jobs.has(name)) {
      this.stop(name);
      this.jobs.delete(name);
      return true;
    }
    
    return false;
  }

  /**
   * Get next run time for a cron expression
   */
  getNextRun(cronExpression) {
    try {
      const schedule = cron.schedule(cronExpression, () => {}, { scheduled: false });
      // Use the underlying cron job to get next run
      const cronJob = schedule.job;
      return cronJob ? cronJob.nextDates(1)[0] : null;
    } catch {
      return null;
    }
  }

  /**
   * List all scheduled jobs
   */
  list() {
    const jobs = [];
    
    for (const [name, jobInfo] of this.jobs) {
      jobs.push({
        name,
        cronExpression: jobInfo.cronExpression,
        enabled: jobInfo.enabled,
        createdAt: jobInfo.createdAt,
        lastRun: jobInfo.lastRun,
        nextRun: this.getNextRun(jobInfo.cronExpression),
        lastStatus: jobInfo.lastStatus
      });
    }
    
    return jobs;
  }

  /**
   * Get job details
   */
  get(name) {
    const jobInfo = this.jobs.get(name);
    
    if (!jobInfo) {
      return null;
    }
    
    return {
      name: jobInfo.name,
      cronExpression: jobInfo.cronExpression,
      enabled: jobInfo.enabled,
      createdAt: jobInfo.createdAt,
      lastRun: jobInfo.lastRun,
      nextRun: this.getNextRun(jobInfo.cronExpression),
      lastStatus: jobInfo.lastStatus,
      lastResult: jobInfo.lastResult,
      lastError: jobInfo.lastError
    };
  }

  /**
   * Stop all scheduled jobs
   */
  stopAll() {
    for (const name of this.jobs.keys()) {
      this.stop(name);
    }
  }

  /**
   * Start all scheduled jobs
   */
  startAll() {
    for (const name of this.jobs.keys()) {
      this.start(name);
    }
  }

  /**
   * Run a job immediately
   */
  async runNow(name) {
    const jobInfo = this.jobs.get(name);
    
    if (!jobInfo) {
      throw new Error(`Job not found: ${name}`);
    }
    
    return await this.executeJob(name, jobInfo.dbConfig, jobInfo.backupOptions);
  }

  /**
   * Load jobs from configuration
   */
  loadFromConfig(config) {
    if (!config.jobs || !Array.isArray(config.jobs)) {
      return;
    }

    for (const jobConfig of config.jobs) {
      this.schedule(
        jobConfig.name,
        jobConfig.database,
        jobConfig.backupOptions || {},
        jobConfig.cron
      );
    }
  }

  /**
   * Export jobs to configuration
   */
  exportConfig() {
    const jobs = [];
    
    for (const [name, jobInfo] of this.jobs) {
      jobs.push({
        name,
        cron: jobInfo.cronExpression,
        database: jobInfo.dbConfig,
        backupOptions: jobInfo.backupOptions
      });
    }
    
    return { jobs };
  }

  /**
   * Get scheduler statistics
   */
  getStats() {
    const stats = {
      totalJobs: this.jobs.size,
      enabledJobs: 0,
      disabledJobs: 0,
      successCount: 0,
      errorCount: 0
    };

    for (const jobInfo of this.jobs.values()) {
      if (jobInfo.enabled) {
        stats.enabledJobs++;
      } else {
        stats.disabledJobs++;
      }
      
      if (jobInfo.lastStatus === 'success') {
        stats.successCount++;
      } else if (jobInfo.lastStatus === 'error') {
        stats.errorCount++;
      }
    }

    return stats;
  }
}

/**
 * Create scheduler instance
 */
const createScheduler = (config = {}) => {
  return new BackupScheduler(config);
};

module.exports = {
  BackupScheduler,
  createScheduler
};