/**
 * Constants for the database backup utility
 */

// Supported database types
const DB_TYPES = {
  MYSQL: 'mysql',
  POSTGRESQL: 'postgresql',
  MONGODB: 'mongodb',
  SQLITE: 'sqlite'
};

// Default ports for each database type
const DEFAULT_PORTS = {
  [DB_TYPES.MYSQL]: 3306,
  [DB_TYPES.POSTGRESQL]: 5432,
  [DB_TYPES.MONGODB]: 27017,
  [DB_TYPES.SQLITE]: null
};

// Backup types
const BACKUP_TYPES = {
  FULL: 'full',
  INCREMENTAL: 'incremental',
  DIFFERENTIAL: 'differential'
};

// Storage types
const STORAGE_TYPES = {
  LOCAL: 'local',
  S3: 's3',
  GCS: 'gcs',
  AZURE: 'azure'
};

// Default configuration
const DEFAULT_CONFIG = {
  backupDir: './backups',
  compression: true,
  logLevel: 'info',
  logFile: './logs/backup.log',
  retention: 30, // days
  notifications: {
    slack: {
      enabled: false,
      webhookUrl: null
    }
  }
};

// Backup file extensions
const BACKUP_EXTENSIONS = {
  [DB_TYPES.MYSQL]: '.sql',
  [DB_TYPES.POSTGRESQL]: '.sql',
  [DB_TYPES.MONGODB]: '.json',
  [DB_TYPES.SQLITE]: '.sqlite'
};

// Messages
const MESSAGES = {
  CONNECTION_SUCCESS: 'Successfully connected to database',
  CONNECTION_FAILED: 'Failed to connect to database',
  BACKUP_STARTED: 'Backup operation started',
  BACKUP_COMPLETED: 'Backup operation completed successfully',
  BACKUP_FAILED: 'Backup operation failed',
  RESTORE_STARTED: 'Restore operation started',
  RESTORE_COMPLETED: 'Restore operation completed successfully',
  RESTORE_FAILED: 'Restore operation failed',
  INVALID_DB_TYPE: 'Invalid database type specified',
  MISSING_CONNECTION_PARAMS: 'Missing required connection parameters',
  FILE_NOT_FOUND: 'Backup file not found',
  COMPRESSION_STARTED: 'Compressing backup file...',
  COMPRESSION_COMPLETED: 'Backup file compressed successfully',
  UPLOAD_STARTED: 'Uploading backup to cloud storage...',
  UPLOAD_COMPLETED: 'Backup uploaded to cloud storage successfully'
};

module.exports = {
  DB_TYPES,
  DEFAULT_PORTS,
  BACKUP_TYPES,
  STORAGE_TYPES,
  DEFAULT_CONFIG,
  BACKUP_EXTENSIONS,
  MESSAGES
};