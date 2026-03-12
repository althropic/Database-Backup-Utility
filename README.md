# Database Backup Utility

A powerful, cross-platform command-line interface (CLI) utility for backing up and restoring various types of databases. This tool supports MySQL, PostgreSQL, MongoDB, and SQLite with automatic backup scheduling, compression, cloud storage, and Slack notifications.

## Features

- **Multi-Database Support**: MySQL, PostgreSQL, MongoDB, and SQLite
- **Backup Types**: Full, incremental, and differential backups
- **Compression**: Automatic gzip compression for backup files
- **Cloud Storage**: Support for AWS S3, Google Cloud Storage, and Azure Blob Storage
- **Local Storage**: Store backups locally with retention policies
- **Logging**: Detailed logging with timestamps and status tracking
- **Notifications**: Slack webhook notifications for backup operations
- **Scheduling**: Cron-based automatic backup scheduling
- **Selective Restore**: Restore specific tables or collections
- **Interactive Wizard**: User-friendly interactive CLI wizard

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd database-backup-utility

# Install dependencies
npm install

# Link for global usage
npm link
```

## Quick Start

### Interactive Mode

Run the interactive wizard to guide you through the backup process:

```bash
db-backup wizard
```

### Backup Commands

**MySQL Backup:**
```bash
db-backup backup \
  --type mysql \
  --host localhost \
  --port 3306 \
  --username root \
  --password yourpassword \
  --database mydb \
  --output ./backups
```

**PostgreSQL Backup:**
```bash
db-backup backup \
  --type postgresql \
  --host localhost \
  --port 5432 \
  --username postgres \
  --password yourpassword \
  --database mydb \
  --output ./backups
```

**MongoDB Backup:**
```bash
db-backup backup \
  --type mongodb \
  --host localhost \
  --port 27017 \
  --username admin \
  --password yourpassword \
  --database mydb \
  --output ./backups
```

**SQLite Backup:**
```bash
db-backup backup \
  --type sqlite \
  --file /path/to/database.sqlite \
  --output ./backups
```

### Restore Commands

**MySQL Restore:**
```bash
db-backup restore \
  --type mysql \
  --host localhost \
  --username root \
  --password yourpassword \
  --database mydb \
  --file /path/to/backup.sql.gz
```

**MongoDB Restore with Selective Collections:**
```bash
db-backup restore \
  --type mongodb \
  --host localhost \
  --database mydb \
  --file /path/to/backup.json \
  --collections users,products
```

## CLI Commands

### `db-backup wizard`

Start the interactive wizard for guided backup and restore operations.

### `db-backup backup`

Create a database backup.

**Required Options:**
- `-t, --type <type>` - Database type (mysql, postgresql, mongodb, sqlite)

**Connection Options:**
- `-h, --host <host>` - Database host (default: localhost)
- `-p, --port <port>` - Database port
- `-u, --username <username>` - Database username
- `-P, --password <password>` - Database password
- `-d, --database <database>` - Database name
- `-f, --file <file>` - Database file path (SQLite only)
- `--uri <uri>` - Connection URI (MongoDB)
- `--authSource <source>` - Authentication source (MongoDB)

**Backup Options:**
- `-b, --backup-type <type>` - Backup type (full, incremental, differential)
- `-o, --output <directory>` - Output directory (default: ./backups)
- `--no-compress` - Disable compression

**Storage Options:**
- `-s, --storage <type>` - Storage type (local, s3, gcs, azure)
- `--bucket <bucket>` - Cloud storage bucket
- `--region <region>` - Cloud storage region
- `--access-key-id <id>` - AWS access key ID
- `--secret-access-key <key>` - AWS secret access key
- `--connection-string <str>` - Azure connection string
- `--container-name <name>` - Azure container name

**Notification Options:**
- `--slack-webhook <url>` - Slack webhook URL for notifications

### `db-backup restore`

Restore a database from a backup file.

**Required Options:**
- `-t, --type <type>` - Database type
- `-f, --file <file>` - Backup file path

**Additional Options:**
- `--collections <collections>` - Collections to restore (MongoDB, comma-separated)
- `--tables <tables>` - Tables to restore (SQL, comma-separated)
- `--drop` - Drop existing collections/tables before restore

### `db-backup test`

Test database connection.

```bash
db-backup test --type mysql --host localhost --username root --password yourpassword --database mydb
```

### `db-backup list`

List available backups.

```bash
db-backup list --directory ./backups
```

### `db-backup schedule`

Manage scheduled backups.

```bash
db-backup schedule add --name daily-backup --cron "0 0 * * *"
db-backup schedule list
db-backup schedule remove --name daily-backup
```

## Programmatic Usage

```javascript
const { createBackupManager } = require('./src/database/backup');
const { createRestoreManager } = require('./src/database/restore');
const { createStorageManager } = require('./src/storage/storage');
const { createNotificationManager } = require('./src/notifications/notifications');
const { createLogger } = require('./src/utils/logger');

// Create a backup
async function createBackup() {
  const logger = createLogger();
  
  const dbConfig = {
    type: 'mysql',
    host: 'localhost',
    port: 3306,
    username: 'root',
    password: 'password',
    database: 'mydb'
  };

  const backupOptions = {
    type: 'full',
    backupDir: './backups',
    compression: true
  };

  const backupManager = createBackupManager(dbConfig, backupOptions, logger);
  const result = await backupManager.performBackup();
  
  console.log('Backup created:', result.filePath);
  console.log('File size:', result.fileSize);
  console.log('Duration:', result.duration);
}

// Restore from backup
async function restoreBackup() {
  const dbConfig = {
    type: 'mysql',
    host: 'localhost',
    username: 'root',
    password: 'password',
    database: 'mydb'
  };

  const restoreManager = createRestoreManager(dbConfig, {}, logger);
  const result = await restoreManager.performRestore('./backups/mydb_full_2024-01-01.sql.gz');
  
  console.log('Restore completed:', result.filePath);
}

// Upload to cloud storage
async function uploadToS3() {
  const storageManager = createStorageManager({
    type: 's3',
    bucket: 'my-backup-bucket',
    region: 'us-east-1',
    accessKeyId: 'YOUR_ACCESS_KEY',
    secretAccessKey: 'YOUR_SECRET_KEY'
  });

  const result = await storageManager.save('./backups/backup.sql.gz', 'backup.sql.gz');
  console.log('Uploaded to:', result.path);
}

// Send Slack notification
async function sendNotification() {
  const notificationManager = createNotificationManager({
    slack: {
      webhookUrl: 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL'
    }
  });

  await notificationManager.notifyBackupComplete({
    databaseType: 'mysql',
    databaseName: 'mydb',
    filePath: '/backups/mydb_backup.sql.gz',
    fileSize: 1024000,
    duration: 5000
  });
}
```

## Scheduler Usage

```javascript
const { createScheduler } = require('./src/scheduler/scheduler');
const { createLogger } = require('./src/utils/logger');

const logger = createLogger();

const scheduler = createScheduler({
  logger,
  timezone: 'America/New_York',
  notifications: {
    slack: {
      webhookUrl: 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL'
    }
  }
});

// Schedule daily backups
scheduler.schedule(
  'daily-backup',
  { type: 'mysql', host: 'localhost', username: 'root', password: 'password', database: 'mydb' },
  { backupDir: './backups', compression: true },
  '0 0 * * *' // Every day at midnight
);

// Schedule hourly backups
scheduler.schedule(
  'hourly-backup',
  { type: 'mongodb', uri: 'mongodb://localhost:27017/mydb', database: 'mydb' },
  { backupDir: './backups', compression: true },
  '0 * * * *' // Every hour
);

// List all scheduled jobs
const jobs = scheduler.list();
console.log(jobs);

// Get job details
const jobDetails = scheduler.get('daily-backup');
console.log(jobDetails);

// Run a job manually
await scheduler.runNow('daily-backup');

// Stop scheduler
scheduler.stopAll();
```

## Project Structure

```
database-backup-utility/
├── src/
│   ├── config/
│   │   └── constants.js          # Configuration constants
│   ├── database/
│   │   ├── connection.js         # Database connection management
│   │   ├── backup.js            # Backup operations
│   │   └── restore.js           # Restore operations
│   ├── notifications/
│   │   └── notifications.js      # Slack notifications
│   ├── scheduler/
│   │   └── scheduler.js          # Backup scheduling
│   ├── storage/
│   │   └── storage.js           # Storage providers (local, S3, GCS, Azure)
│   ├── utils/
│   │   └── logger.js            # Winston-based logging
│   └── index.js                 # CLI entry point
├── tests/
│   ├── connection.test.js       # Connection tests
│   ├── storage.test.js          # Storage tests
│   └── notifications.test.js    # Notification tests
├── package.json
├── jest.config.js
├── .gitignore
└── README.md
```

## Configuration

### Cloud Storage Credentials

**AWS S3:**
```bash
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
```

Or provide via CLI options:
```bash
db-backup backup ... --storage s3 --bucket my-bucket --access-key-id XXX --secret-access-key YYY
```

**Google Cloud Storage:**
Set `GOOGLE_APPLICATION_CREDENTIALS` environment variable or use `--key-filename` option.

**Azure Blob Storage:**
Provide connection string via `--connection-string` and container via `--container-name`.

## Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test -- --coverage

# Run specific test file
npm test -- connection.test.js
```

## Error Handling

The utility implements comprehensive error handling:

- Connection errors are caught and displayed with helpful messages
- Backup/restore operations are logged to files in the `logs/` directory
- Notifications are sent on both success and failure
- Retention policies can be configured to automatically clean up old backups

## Logs

Logs are stored in the `logs/` directory:

- `backup.log` - All backup operations
- `error.log` - Error-level logs only

Log format:
```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "level": "info",
  "message": "Backup completed",
  "databaseType": "mysql",
  "databaseName": "mydb",
  "filePath": "/backups/mydb_backup.sql.gz",
  "duration": 5000,
  "status": "success"
}
```

## Retention Policy

Backups can be automatically cleaned up based on a retention policy:

```javascript
const storageManager = createStorageManager({
  type: 'local',
  backupDir: './backups',
  retention: 30 // days
});

// Delete backups older than 30 days
const deleted = await storageManager.applyRetentionPolicy();
console.log('Deleted:', deleted);
```

## Security Best Practices

1. **Credentials**: Never commit database credentials to version control
2. **Environment Variables**: Use `.env` files for sensitive configuration
3. **Encryption**: Cloud storage providers support encryption at rest
4. **Access Control**: Restrict database user permissions to minimum required
5. **Network**: Use SSL/TLS for database connections when possible

## Performance Considerations

- Large databases: Consider using incremental backups
- Compression: Enabled by default, disable for faster backup but larger files
- Cloud Upload: Occurs after local backup is complete
- Memory Usage: Stream-based processing for large datasets

## Troubleshooting

### Connection Issues

```bash
# Test connection first
db-backup test --type mysql --host localhost --username root --password yourpassword --database mydb
```

### Permission Errors

Ensure the database user has sufficient privileges:
- MySQL: `SELECT, LOCK TABLES, SHOW VIEW, TRIGGER`
- PostgreSQL: `CONNECT, SELECT ON ALL TABLES`
- MongoDB: `read` role on database

### Storage Issues

- Verify write permissions to backup directory
- Check available disk space
- Ensure cloud credentials are configured correctly

## License

MIT License - See LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Support

For issues and feature requests, please use the GitHub issue tracker.

## Roadmap

- [ ] Web UI for backup management
- [ ] Database migration tools
- [ ] Real-time backup monitoring
- [ ] Multi-database transaction support
- [ ] Backup encryption
- [ ] Additional notification channels (Email, PagerDuty, etc.)

## Credits

Created as part of the [Backend Developer Roadmap](https://roadmap.sh/projects/database-backup-utility) learning path.