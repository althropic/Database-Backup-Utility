#!/usr/bin/env node

const { Command } = require('commander');
const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
const { DB_TYPES, BACKUP_TYPES, STORAGE_TYPES, DEFAULT_CONFIG } = require('./config/constants');
const { createConnection } = require('./database/connection');
const { createBackupManager } = require('./database/backup');
const { createRestoreManager } = require('./database/restore');
const { createStorageManager } = require('./storage/storage');
const { createNotificationManager } = require('./notifications/notifications');
const { createScheduler } = require('./scheduler/scheduler');
const { createLogger, addConsoleTransport } = require('./utils/logger');
const fs = require('fs-extra');
const path = require('path');
const Configstore = require('configstore');

// Create config store for saved configurations
const configStore = new Configstore('db-backup-utility');

// Create CLI program
const program = new Command();

// Initialize logger
const logger = addConsoleTransport(createLogger());

// Spinner utility
const createSpinner = (text) => ora(text);

/**
 * Main backup command
 */
async function performBackup(options) {
  const spinner = createSpinner('Connecting to database...').start();
  
  try {
    // Build database config
    const dbConfig = {
      type: options.type,
      host: options.host,
      port: options.port ? parseInt(options.port) : undefined,
      username: options.username,
      password: options.password,
      database: options.database,
      filePath: options.file,
      uri: options.uri,
      authSource: options.authSource
    };

    // Test connection
    spinner.text = 'Testing connection...';
    const connection = createConnection(dbConfig);
    await connection.testConnection();
    
    spinner.text = 'Creating backup...';
    
    // Create backup options
    const backupOptions = {
      type: options.backupType,
      backupDir: options.output,
      compression: options.compress !== false
    };

    // Create backup manager
    const backupManager = createBackupManager(dbConfig, backupOptions, logger);
    
    // Perform backup
    const result = await backupManager.performBackup();
    
    spinner.succeed(chalk.green('Backup completed successfully!'));
    
    // Display result
    console.log('\n' + chalk.bold('Backup Details:'));
    console.log(chalk.dim('  File:'), chalk.cyan(result.filePath));
    console.log(chalk.dim('  Size:'), chalk.cyan(formatFileSize(result.fileSize)));
    console.log(chalk.dim('  Duration:'), chalk.cyan(formatDuration(result.duration)));

    // Upload to cloud storage if specified
    if (options.storage && options.storage !== 'local') {
      spinner.start('Uploading to cloud storage...');
      
      const storageConfig = {
        type: options.storage,
        bucket: options.bucket,
        region: options.region,
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        connectionString: options.connectionString,
        containerName: options.containerName,
        projectId: options.projectId,
        keyFilename: options.keyFilename,
        prefix: options.prefix
      };

      const storageManager = createStorageManager(storageConfig);
      await storageManager.save(result.filePath, path.basename(result.filePath));
      
      spinner.succeed(chalk.green('Backup uploaded to cloud storage!'));
    }

    // Send notification if configured
    if (options.slackWebhook) {
      const notificationManager = createNotificationManager({
        slack: { webhookUrl: options.slackWebhook }
      });
      
      await notificationManager.notifyBackupComplete({
        databaseType: dbConfig.type,
        databaseName: dbConfig.database || dbConfig.filePath,
        filePath: result.filePath,
        fileSize: result.fileSize,
        duration: result.duration
      });
    }

    return result;

  } catch (error) {
    spinner.fail(chalk.red('Backup failed!'));
    console.error(chalk.red(error.message));
    throw error;
  }
}

/**
 * Restore command
 */
async function performRestore(options) {
  const spinner = createSpinner('Connecting to database...').start();
  
  try {
    // Build database config
    const dbConfig = {
      type: options.type,
      host: options.host,
      port: options.port ? parseInt(options.port) : undefined,
      username: options.username,
      password: options.password,
      database: options.database,
      filePath: options.file
    };

    // Test connection
    spinner.text = 'Testing connection...';
    const connection = createConnection(dbConfig);
    await connection.testConnection();
    
    spinner.text = 'Restoring database...';
    
    // Create restore options
    const restoreOptions = {
      collections: options.collections ? options.collections.split(',') : null,
      tables: options.tables ? options.tables.split(',') : null,
      dropCollections: options.drop
    };

    // Download from cloud storage if specified
    let restoreFile = options.file;
    if (options.storage && options.storage !== 'local') {
      spinner.text = 'Downloading from cloud storage...';
      
      const storageConfig = {
        type: options.storage,
        bucket: options.bucket,
        region: options.region,
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        connectionString: options.connectionString,
        containerName: options.containerName,
        projectId: options.projectId,
        keyFilename: options.keyFilename
      };

      const storageManager = createStorageManager(storageConfig);
      restoreFile = await storageManager.retrieve(options.file, path.join(process.cwd(), path.basename(options.file)));
      
      spinner.text = 'Restoring database...';
    }

    // Create restore manager
    const restoreManager = createRestoreManager(dbConfig, restoreOptions, logger);
    
    // Perform restore
    const result = await restoreManager.performRestore(restoreFile);
    
    spinner.succeed(chalk.green('Restore completed successfully!'));
    
    // Display result
    console.log('\n' + chalk.bold('Restore Details:'));
    console.log(chalk.dim('  File:'), chalk.cyan(result.filePath));
    console.log(chalk.dim('  Duration:'), chalk.cyan(formatDuration(result.duration)));

    // Send notification if configured
    if (options.slackWebhook) {
      const notificationManager = createNotificationManager({
        slack: { webhookUrl: options.slackWebhook }
      });
      
      await notificationManager.notifyRestoreComplete({
        databaseType: dbConfig.type,
        databaseName: dbConfig.database || dbConfig.filePath,
        duration: result.duration
      });
    }

    return result;

  } catch (error) {
    spinner.fail(chalk.red('Restore failed!'));
    console.error(chalk.red(error.message));
    throw error;
  }
}

/**
 * Format file size
 */
function formatFileSize(bytes) {
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
 * Format duration
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Interactive wizard
 */
async function startWizard() {
  console.log(chalk.bold.blue('\nDatabase Backup Utility Wizard\n'));
  
  // Select operation
  const { operation } = await inquirer.prompt([
    {
      type: 'list',
      name: 'operation',
      message: 'What would you like to do?',
      choices: [
        { name: 'Create Backup', value: 'backup' },
        { name: 'Restore Backup', value: 'restore' },
        { name: 'Schedule Backup', value: 'schedule' },
        { name: 'List Backups', value: 'list' },
        { name: 'Saved Configurations', value: 'config' }
      ]
    }
  ]);

  switch (operation) {
    case 'backup':
      await backupWizard();
      break;
    case 'restore':
      await restoreWizard();
      break;
    case 'schedule':
      await scheduleWizard();
      break;
    case 'list':
      await listBackupsWizard();
      break;
    case 'config':
      await configWizard();
      break;
  }
}

/**
 * Backup wizard
 */
async function backupWizard() {
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'type',
      message: 'Select database type:',
      choices: Object.values(DB_TYPES)
    },
    {
      type: 'input',
      name: 'host',
      message: 'Enter database host:',
      default: 'localhost',
      when: (answers) => answers.type !== 'sqlite'
    },
    {
      type: 'input',
      name: 'port',
      message: 'Enter database port:',
      default: (answers) => {
        const defaults = { mysql: '3306', postgresql: '5432', mongodb: '27017' };
        return defaults[answers.type];
      },
      when: (answers) => answers.type !== 'sqlite'
    },
    {
      type: 'input',
      name: 'database',
      message: (answers) => answers.type === 'sqlite' ? 'Enter database file path:' : 'Enter database name:',
      validate: (input) => input.length > 0 || 'This field is required'
    },
    {
      type: 'input',
      name: 'username',
      message: 'Enter username:',
      when: (answers) => answers.type !== 'sqlite'
    },
    {
      type: 'password',
      name: 'password',
      message: 'Enter password:',
      mask: '*',
      when: (answers) => answers.type !== 'sqlite'
    },
    {
      type: 'list',
      name: 'backupType',
      message: 'Select backup type:',
      choices: Object.values(BACKUP_TYPES),
      default: BACKUP_TYPES.FULL
    },
    {
      type: 'input',
      name: 'output',
      message: 'Enter output directory:',
      default: './backups'
    },
    {
      type: 'confirm',
      name: 'compress',
      message: 'Compress backup?',
      default: true
    },
    {
      type: 'list',
      name: 'storage',
      message: 'Select storage type:',
      choices: Object.values(STORAGE_TYPES),
      default: STORAGE_TYPES.LOCAL
    },
    {
      type: 'confirm',
      name: 'useSlack',
      message: 'Send Slack notification?',
      default: false
    },
    {
      type: 'input',
      name: 'slackWebhook',
      message: 'Enter Slack webhook URL:',
      when: (answers) => answers.useSlack
    }
  ]);

  // Build options
  const options = {
    ...answers,
    file: answers.type === 'sqlite' ? answers.database : undefined
  };

  // Execute backup
  await performBackup(options);
}

/**
 * Restore wizard
 */
async function restoreWizard() {
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'type',
      message: 'Select database type:',
      choices: Object.values(DB_TYPES)
    },
    {
      type: 'input',
      name: 'host',
      message: 'Enter database host:',
      default: 'localhost',
      when: (answers) => answers.type !== 'sqlite'
    },
    {
      type: 'input',
      name: 'port',
      message: 'Enter database port:',
      default: (answers) => {
        const defaults = { mysql: '3306', postgresql: '5432', mongodb: '27017' };
        return defaults[answers.type];
      },
      when: (answers) => answers.type !== 'sqlite'
    },
    {
      type: 'input',
      name: 'database',
      message: (answers) => answers.type === 'sqlite' ? 'Enter database file path:' : 'Enter database name:',
      validate: (input) => input.length > 0 || 'This field is required'
    },
    {
      type: 'input',
      name: 'username',
      message: 'Enter username:',
      when: (answers) => answers.type !== 'sqlite'
    },
    {
      type: 'password',
      name: 'password',
      message: 'Enter password:',
      mask: '*',
      when: (answers) => answers.type !== 'sqlite'
    },
    {
      type: 'input',
      name: 'file',
      message: 'Enter backup file path:',
      validate: async (input) => {
        const exists = await fs.pathExists(input);
        return exists || 'File does not exist';
      }
    }
  ]);

  // Build options
  const options = {
    ...answers,
    file: answers.file
  };

  // Execute restore
  await performRestore(options);
}

/**
 * Schedule wizard
 */
async function scheduleWizard() {
  console.log(chalk.yellow('\nSchedule configuration coming soon!'));
}

/**
 * List backups wizard
 */
async function listBackupsWizard() {
  const { directory } = await inquirer.prompt([
    {
      type: 'input',
      name: 'directory',
      message: 'Enter backup directory:',
      default: './backups'
    }
  ]);

  const spinner = createSpinner('Loading backups...').start();
  
  try {
    const storageManager = createStorageManager({ type: 'local', backupDir: directory });
    const backups = await storageManager.list();
    
    spinner.stop();
    
    if (backups.length === 0) {
      console.log(chalk.yellow('\nNo backups found.'));
      return;
    }

    console.log(chalk.bold('\nBackups:\n'));
    
    const { backup: selectedBackup } = await inquirer.prompt([
      {
        type: 'list',
        name: 'backup',
        message: 'Select a backup:',
        choices: backups.map(b => ({
          name: `${b.filename} (${formatFileSize(b.size)}) - ${b.modified.toLocaleString()}`,
          value: b
        }))
      }
    ]);

    console.log(chalk.bold('\nBackup Details:'));
    console.log(chalk.dim('  Filename:'), chalk.cyan(selectedBackup.filename));
    console.log(chalk.dim('  Path:'), chalk.cyan(selectedBackup.path));
    console.log(chalk.dim('  Size:'), chalk.cyan(formatFileSize(selectedBackup.size)));
    console.log(chalk.dim('  Created:'), chalk.cyan(selectedBackup.created.toLocaleString()));
    console.log(chalk.dim('  Modified:'), chalk.cyan(selectedBackup.modified.toLocaleString()));

  } catch (error) {
    spinner.fail(chalk.red('Failed to load backups!'));
    console.error(chalk.red(error.message));
  }
}

/**
 * Configuration wizard
 */
async function configWizard() {
  console.log(chalk.yellow('\nConfiguration management coming soon!'));
}

/**
 * Test database connection
 */
async function testConnection(options) {
  const spinner = createSpinner('Testing connection...').start();
  
  try {
    const dbConfig = {
      type: options.type,
      host: options.host,
      port: options.port ? parseInt(options.port) : undefined,
      username: options.username,
      password: options.password,
      database: options.database,
      filePath: options.file,
      uri: options.uri,
      authSource: options.authSource
    };

    const connection = createConnection(dbConfig);
    const result = await connection.testConnection();
    
    spinner.succeed(chalk.green('Connection successful!'));
    console.log(chalk.green(result.message));
    
  } catch (error) {
    spinner.fail(chalk.red('Connection failed!'));
    console.error(chalk.red(error.message));
    throw error;
  }
}

/**
 * List backups
 */
async function listBackups(options) {
  const storageManager = createStorageManager({ 
    type: options.storage || 'local',
    backupDir: options.directory
  });

  const backups = await storageManager.list();

  if (backups.length === 0) {
    console.log(chalk.yellow('No backups found.'));
    return;
  }

  console.log(chalk.bold('\nBackups:\n'));
  
  backups.forEach(backup => {
    console.log(chalk.cyan(backup.filename));
    console.log(chalk.dim(`  Size: ${formatFileSize(backup.size)}`));
    console.log(chalk.dim(`  Modified: ${backup.modified.toLocaleString()}`));
    console.log(chalk.dim(`  Storage: ${backup.storageType}`));
    console.log();
  });

  console.log(chalk.dim(`Total: ${backups.length} backup(s)`));
}

// Configure CLI
program
  .name('db-backup')
  .description('Database Backup Utility - Backup and restore various database types')
  .version('1.0.0');

// Interactive wizard command
program
  .command('wizard')
  .description('Start interactive wizard')
  .action(async () => {
    await startWizard();
  });

// Backup command
program
  .command('backup')
  .description('Create a database backup')
  .requiredOption('-t, --type <type>', 'Database type (mysql, postgresql, mongodb, sqlite)')
  .option('-h, --host <host>', 'Database host')
  .option('-p, --port <port>', 'Database port')
  .option('-u, --username <username>', 'Database username')
  .option('-P, --password <password>', 'Database password')
  .option('-d, --database <database>', 'Database name')
  .option('-f, --file <file>', 'Database file path (for SQLite)')
  .option('--uri <uri>', 'Connection URI (for MongoDB)')
  .option('--authSource <source>', 'Authentication source (for MongoDB)')
  .option('-b, --backup-type <type>', 'Backup type (full, incremental, differential)', 'full')
  .option('-o, --output <directory>', 'Output directory', './backups')
  .option('--no-compress', 'Disable compression')
  .option('-s, --storage <type>', 'Storage type (local, s3, gcs, azure)', 'local')
  .option('--bucket <bucket>', 'Cloud storage bucket')
  .option('--region <region>', 'Cloud storage region')
  .option('--access-key-id <id>', 'AWS access key ID')
  .option('--secret-access-key <key>', 'AWS secret access key')
  .option('--connection-string <str>', 'Azure connection string')
  .option('--container-name <name>', 'Azure container name')
  .option('--slack-webhook <url>', 'Slack webhook URL for notifications')
  .action(async (options) => {
    await performBackup(options);
  });

// Restore command
program
  .command('restore')
  .description('Restore a database from backup')
  .requiredOption('-t, --type <type>', 'Database type (mysql, postgresql, mongodb, sqlite)')
  .requiredOption('-f, --file <file>', 'Backup file path')
  .option('-h, --host <host>', 'Database host')
  .option('-p, --port <port>', 'Database port')
  .option('-u, --username <username>', 'Database username')
  .option('-P, --password <password>', 'Database password')
  .option('-d, --database <database>', 'Database name')
  .option('--collections <collections>', 'Collections to restore (comma-separated, for MongoDB)')
  .option('--tables <tables>', 'Tables to restore (comma-separated, for SQL)')
  .option('--drop', 'Drop existing collections/tables before restore')
  .option('-s, --storage <type>', 'Storage type (local, s3, gcs, azure)', 'local')
  .option('--bucket <bucket>', 'Cloud storage bucket')
  .option('--region <region>', 'Cloud storage region')
  .option('--access-key-id <id>', 'AWS access key ID')
  .option('--secret-access-key <key>', 'AWS secret access key')
  .option('--slack-webhook <url>', 'Slack webhook URL for notifications')
  .action(async (options) => {
    await performRestore(options);
  });

// Test connection command
program
  .command('test')
  .description('Test database connection')
  .requiredOption('-t, --type <type>', 'Database type (mysql, postgresql, mongodb, sqlite)')
  .option('-h, --host <host>', 'Database host')
  .option('-p, --port <port>', 'Database port')
  .option('-u, --username <username>', 'Database username')
  .option('-P, --password <password>', 'Database password')
  .option('-d, --database <database>', 'Database name')
  .option('-f, --file <file>', 'Database file path (for SQLite)')
  .option('--uri <uri>', 'Connection URI (for MongoDB)')
  .action(async (options) => {
    await testConnection(options);
  });

// List backups command
program
  .command('list')
  .description('List available backups')
  .option('-d, --directory <directory>', 'Backup directory', './backups')
  .option('-s, --storage <type>', 'Storage type (local, s3, gcs, azure)', 'local')
  .action(async (options) => {
    await listBackups(options);
  });

// Schedule command
program
  .command('schedule')
  .description('Manage scheduled backups')
  .argument('<action>', 'Action (add, list, remove, run)')
  .option('-n, --name <name>', 'Job name')
  .option('-c, --cron <expression>', 'Cron expression')
  .option('-t, --type <type>', 'Database type')
  .option('-h, --host <host>', 'Database host')
  .option('-d, --database <database>', 'Database name')
  .option('--list', 'List scheduled jobs')
  .action(async (action, options) => {
    console.log(chalk.yellow(`Scheduling action '${action}' - coming soon!`));
  });

// Parse arguments and run
program.parse();