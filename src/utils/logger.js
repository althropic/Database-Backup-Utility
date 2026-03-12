const winston = require('winston');
const fs = require('fs-extra');
const path = require('path');

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
fs.ensureDirSync(logsDir);

// Create logger instance
const createLogger = (logFile = 'backup.log') => {
  return winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    defaultMeta: { service: 'database-backup-utility' },
    transports: [
      // Write all logs with level 'error' and below to error.log
      new winston.transports.File({
        filename: path.join(logsDir, 'error.log'),
        level: 'error'
      }),
      // Write all logs to combined.log
      new winston.transports.File({
        filename: path.join(logsDir, logFile)
      })
    ]
  });
};

// Add console transport for development
const addConsoleTransport = (logger) => {
  if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }));
  }
  return logger;
};

// Backup log entry structure
const createBackupLogEntry = (options) => {
  const {
    databaseType,
    databaseName,
    backupType,
    startTime,
    endTime,
    status,
    filePath,
    fileSize,
    duration,
    error
  } = options;

  return {
    timestamp: new Date().toISOString(),
    databaseType,
    databaseName,
    backupType,
    startTime,
    endTime,
    status,
    filePath,
    fileSize,
    duration: duration ? `${duration}ms` : null,
    error: error ? error.message : null
  };
};

// Log backup start
const logBackupStart = (logger, options) => {
  const { databaseType, databaseName, backupType } = options;
  logger.info(`Backup started`, {
    databaseType,
    databaseName,
    backupType,
    startTime: new Date().toISOString()
  });
};

// Log backup completion
const logBackupComplete = (logger, options) => {
  const {
    databaseType,
    databaseName,
    backupType,
    filePath,
    fileSize,
    duration
  } = options;
  logger.info(`Backup completed`, {
    databaseType,
    databaseName,
    backupType,
    filePath,
    fileSize,
    duration,
    status: 'success',
    endTime: new Date().toISOString()
  });
};

// Log backup error
const logBackupError = (logger, options) => {
  const { databaseType, databaseName, backupType, error, duration } = options;
  logger.error(`Backup failed`, {
    databaseType,
    databaseName,
    backupType,
    error: error.message,
    stack: error.stack,
    duration,
    status: 'failed',
    endTime: new Date().toISOString()
  });
};

// Log restore start
const logRestoreStart = (logger, options) => {
  const { databaseType, databaseName, filePath } = options;
  logger.info(`Restore started`, {
    databaseType,
    databaseName,
    filePath,
    startTime: new Date().toISOString()
  });
};

// Log restore completion
const logRestoreComplete = (logger, options) => {
  const { databaseType, databaseName, filePath, duration } = options;
  logger.info(`Restore completed`, {
    databaseType,
    databaseName,
    filePath,
    duration,
    status: 'success',
    endTime: new Date().toISOString()
  });
};

// Log restore error
const logRestoreError = (logger, options) => {
  const { databaseType, databaseName, filePath, error, duration } = options;
  logger.error(`Restore failed`, {
    databaseType,
    databaseName,
    filePath,
    error: error.message,
    stack: error.stack,
    duration,
    status: 'failed',
    endTime: new Date().toISOString()
  });
};

// Get backup history from log file
const getBackupHistory = async (logFilePath) => {
  try {
    const content = await fs.readFile(logFilePath, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    return lines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(entry => entry !== null);
  } catch {
    return [];
  }
};

module.exports = {
  createLogger,
  addConsoleTransport,
  createBackupLogEntry,
  logBackupStart,
  logBackupComplete,
  logBackupError,
  logRestoreStart,
  logRestoreComplete,
  logRestoreError,
  getBackupHistory
};