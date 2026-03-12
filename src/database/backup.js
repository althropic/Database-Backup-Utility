const { DB_TYPES, BACKUP_TYPES, BACKUP_EXTENSIONS, MESSAGES } = require('../config/constants');
const { createConnection } = require('./connection');
const { logBackupStart, logBackupComplete, logBackupError } = require('../utils/logger');
const path = require('path');
const fs = require('fs-extra');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');

/**
 * Backup manager for various database types
 */
class BackupManager {
  constructor(dbConfig, options = {}, logger = null) {
    this.dbConfig = dbConfig;
    this.options = options;
    this.logger = logger;
    this.connection = null;
    this.startTime = null;
  }

  /**
   * Initialize backup process
   */
  async initialize() {
    // Create backup directory if it doesn't exist
    const backupDir = this.options.backupDir || './backups';
    await fs.ensureDir(backupDir);
  }

  /**
   * Generate backup filename
   */
  generateBackupFilename() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dbName = this.dbConfig.database || this.dbConfig.filePath?.split('/').pop()?.split('.')[0] || 'backup';
    const ext = BACKUP_EXTENSIONS[this.dbConfig.type] || '.backup';
    const backupType = this.options.type || BACKUP_TYPES.FULL;
    
    return `${dbName}_${backupType}_${timestamp}${ext}`;
  }

  /**
   * Perform backup operation
   */
  async performBackup() {
    this.startTime = Date.now();
    const startTime = new Date();
    
    try {
      await this.initialize();
      
      const filename = this.generateBackupFilename();
      const backupDir = this.options.backupDir || './backups';
      const filePath = path.join(backupDir, filename);

      // Log backup start
      if (this.logger) {
        logBackupStart(this.logger, {
          databaseType: this.dbConfig.type,
          databaseName: this.dbConfig.database || this.dbConfig.filePath,
          backupType: this.options.type || BACKUP_TYPES.FULL
        });
      }

      let result;

      switch (this.dbConfig.type) {
        case DB_TYPES.MYSQL:
          result = await this.backupMySQL(filePath);
          break;
        case DB_TYPES.POSTGRESQL:
          result = await this.backupPostgreSQL(filePath);
          break;
        case DB_TYPES.MONGODB:
          result = await this.backupMongoDB(filePath);
          break;
        case DB_TYPES.SQLITE:
          result = await this.backupSQLite(filePath);
          break;
        default:
          throw new Error(MESSAGES.INVALID_DB_TYPE);
      }

      // Compress if enabled
      let finalPath = filePath;
      if (this.options.compression !== false) {
        finalPath = await this.compressFile(filePath);
      }

      const duration = Date.now() - this.startTime;
      const stats = await fs.stat(finalPath);

      // Log backup completion
      if (this.logger) {
        logBackupComplete(this.logger, {
          databaseType: this.dbConfig.type,
          databaseName: this.dbConfig.database || this.dbConfig.filePath,
          backupType: this.options.type || BACKUP_TYPES.FULL,
          filePath: finalPath,
          fileSize: stats.size,
          duration
        });
      }

      return {
        success: true,
        filePath: finalPath,
        fileSize: stats.size,
        duration,
        filename: path.basename(finalPath)
      };

    } catch (error) {
      const duration = Date.now() - this.startTime;

      // Log backup error
      if (this.logger) {
        logBackupError(this.logger, {
          databaseType: this.dbConfig.type,
          databaseName: this.dbConfig.database || this.dbConfig.filePath,
          backupType: this.options.type || BACKUP_TYPES.FULL,
          error,
          duration
        });
      }

      throw error;
    }
  }

  /**
   * Backup MySQL database
   */
  async backupMySQL(filePath) {
    const connection = await createConnection(this.dbConfig);
    const conn = await connection.getConnection();

    try {
      // Get all tables
      const [tables] = await conn.query('SHOW TABLES');
      const tableNames = tables.map(row => Object.values(row)[0]);

      let sqlDump = '-- MySQL Backup\n';
      sqlDump += `-- Generated: ${new Date().toISOString()}\n`;
      sqlDump += `-- Database: ${this.dbConfig.database}\n\n`;
      sqlDump += `CREATE DATABASE IF NOT EXISTS \`${this.dbConfig.database}\`;\n`;
      sqlDump += `USE \`${this.dbConfig.database}\`;\n\n`;

      // Backup each table
      for (const tableName of tableNames) {
        // Get create table statement
        const [createTableRows] = await conn.query(`SHOW CREATE TABLE \`${tableName}\``);
        sqlDump += `-- Table: ${tableName}\n`;
        sqlDump += `DROP TABLE IF EXISTS \`${tableName}\`;\n`;
        sqlDump += `${createTableRows[0]['Create Table']};\n\n`;

        // Get table data
        const [rows] = await conn.query(`SELECT * FROM \`${tableName}\``);
        if (rows.length > 0) {
          const columns = Object.keys(rows[0]);
          for (const row of rows) {
            const values = columns.map(col => {
              const value = row[col];
              if (value === null) return 'NULL';
              if (typeof value === 'number') return value;
              return `'${String(value).replace(/'/g, "''")}'`;
            });
            sqlDump += `INSERT INTO \`${tableName}\` (\`${columns.join('`, `')}\`) VALUES (${values.join(', ')});\n`;
          }
          sqlDump += '\n';
        }
      }

      await fs.writeFile(filePath, sqlDump, 'utf8');
      await connection.close();

      return { success: true, filePath };
    } catch (error) {
      await connection.close();
      throw error;
    }
  }

  /**
   * Backup PostgreSQL database
   */
  async backupPostgreSQL(filePath) {
    const connection = await createConnection(this.dbConfig);
    const client = await connection.getConnection();

    try {
      // Get all tables
      const tablesResult = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `);
      const tableNames = tablesResult.rows.map(row => row.table_name);

      let sqlDump = '-- PostgreSQL Backup\n';
      sqlDump += `-- Generated: ${new Date().toISOString()}\n`;
      sqlDump += `-- Database: ${this.dbConfig.database}\n\n`;

      // Get sequences
      const sequencesResult = await client.query(`
        SELECT sequence_name 
        FROM information_schema.sequences 
        WHERE sequence_schema = 'public'
      `);

      // Backup sequences
      for (const seq of sequencesResult.rows) {
        const seqName = seq.sequence_name;
        const lastValResult = await client.query(`SELECT last_value FROM "${seqName}"`);
        sqlDump += `-- Sequence: ${seqName}\n`;
        sqlDump += `SELECT setval('${seqName}', ${lastValResult.rows[0].last_value});\n\n`;
      }

      // Backup each table
      for (const tableName of tableNames) {
        // Get create table statement
        const createResult = await client.query(`
          SELECT 
            'CREATE TABLE "' || table_name || '" (' || 
            string_agg(column_name || ' ' || data_type || 
              CASE 
                WHEN character_maximum_length IS NOT NULL THEN '(' || character_maximum_length || ')'
                WHEN numeric_precision IS NOT NULL AND numeric_scale IS NOT NULL THEN '(' || numeric_precision || ',' || numeric_scale || ')'
                WHEN numeric_precision IS NOT NULL THEN '(' || numeric_precision || ')'
                ELSE ''
              END || 
              CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END,
              ', ' ORDER BY ordinal_position
            ) || ');' AS create_statement
          FROM information_schema.columns 
          WHERE table_name = $1 AND table_schema = 'public'
          GROUP BY table_name
        `, [tableName]);

        if (createResult.rows.length > 0) {
          sqlDump += `-- Table: ${tableName}\n`;
          sqlDump += `DROP TABLE IF EXISTS "${tableName}" CASCADE;\n`;
          sqlDump += createResult.rows[0].create_statement + '\n\n';

          // Get primary keys
          const pkResult = await client.query(`
            SELECT a.attname
            FROM pg_index i
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indrelid = $1::regclass AND i.indisprimary
          `, [tableName]);

          if (pkResult.rows.length > 0) {
            const pkColumns = pkResult.rows.map(r => `"${r.attname}"`).join(', ');
            sqlDump += `ALTER TABLE "${tableName}" ADD PRIMARY KEY (${pkColumns});\n\n`;
          }
        }

        // Get table data
        const dataResult = await client.query(`SELECT * FROM "${tableName}"`);
        if (dataResult.rows.length > 0) {
          const columns = Object.keys(dataResult.rows[0]);
          for (const row of dataResult.rows) {
            const values = columns.map(col => {
              const value = row[col];
              if (value === null) return 'NULL';
              if (typeof value === 'number') return value;
              return `'${String(value).replace(/'/g, "''")}'`;
            });
            sqlDump += `INSERT INTO "${tableName}" ("${columns.join('", "')}") VALUES (${values.join(', ')});\n`;
          }
          sqlDump += '\n';
        }
      }

      await fs.writeFile(filePath, sqlDump, 'utf8');
      await connection.close();

      return { success: true, filePath };
    } catch (error) {
      await connection.close();
      throw error;
    }
  }

  /**
   * Backup MongoDB database
   */
  async backupMongoDB(filePath) {
    const connection = await createConnection(this.dbConfig);
    const client = await connection.getConnection();

    try {
      const db = client.db(this.dbConfig.database);
      
      // Get all collections
      const collections = await db.listCollections().toArray();
      
      const backupData = {
        metadata: {
          type: 'mongodb',
          database: this.dbConfig.database,
          timestamp: new Date().toISOString(),
          collectionsCount: collections.length
        },
        data: {}
      };

      // Backup each collection
      for (const collectionInfo of collections) {
        const collectionName = collectionInfo.name;
        const collection = db.collection(collectionName);
        const documents = await collection.find({}).toArray();
        backupData.data[collectionName] = documents;

        // Check if we need selective backup
        if (this.options.tables && this.options.tables.length > 0) {
          if (!this.options.tables.includes(collectionName)) {
            delete backupData.data[collectionName];
          }
        }
      }

      await fs.writeJson(filePath, backupData, { spaces: 2 });
      await connection.close();

      return { success: true, filePath };
    } catch (error) {
      await connection.close();
      throw error;
    }
  }

  /**
   * Backup SQLite database
   */
  async backupSQLite(filePath) {
    const connection = await createConnection(this.dbConfig);
    const db = await connection.getConnection();

    try {
      // Get all tables
      const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
      
      let sqlDump = '-- SQLite Backup\n';
      sqlDump += `-- Generated: ${new Date().toISOString()}\n`;
      sqlDump += `-- Database: ${this.dbConfig.filePath}\n\n`;

      // Backup each table
      for (const table of tables) {
        const tableName = table.name;
        
        // Get table schema
        const tableInfo = await db.all(`PRAGMA table_info("${tableName}")`);
        const sql = await db.get(`SELECT sql FROM sqlite_master WHERE name = ?`, [tableName]);
        
        if (sql && sql.sql) {
          sqlDump += `-- Table: ${tableName}\n`;
          sqlDump += `DROP TABLE IF EXISTS "${tableName}";\n`;
          sqlDump += `${sql.sql};\n\n`;
        }

        // Get indexes for the table
        const indexes = await db.all("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=?", [tableName]);
        for (const idx of indexes) {
          if (idx.sql && !idx.name.startsWith('sqlite_')) {
            sqlDump += `CREATE INDEX IF NOT EXISTS "${idx.name}" ${idx.sql};\n`;
          }
        }

        // Get table data
        const rows = await db.all(`SELECT * FROM "${tableName}"`);
        if (rows.length > 0) {
          const columns = Object.keys(rows[0]);
          for (const row of rows) {
            const values = columns.map(col => {
              const value = row[col];
              if (value === null) return 'NULL';
              if (typeof value === 'number') return value;
              return `'${String(value).replace(/'/g, "''")}'`;
            });
            sqlDump += `INSERT INTO "${tableName}" ("${columns.join('", "')}") VALUES (${values.join(', ')});\n`;
          }
          sqlDump += '\n';
        }
      }

      await fs.writeFile(filePath, sqlDump, 'utf8');
      await connection.close();

      return { success: true, filePath };
    } catch (error) {
      await connection.close();
      throw error;
    }
  }

  /**
   * Compress backup file
   */
  async compressFile(filePath) {
    const compressedPath = `${filePath}.gz`;
    
    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(filePath);
      const gzip = zlib.createGzip();
      const writeStream = fs.createWriteStream(compressedPath);

      readStream
        .pipe(gzip)
        .pipe(writeStream)
        .on('finish', async () => {
          // Remove original file
          await fs.remove(filePath);
          resolve(compressedPath);
        })
        .on('error', reject);
    });
  }

  /**
   * Perform incremental backup (track changes from last backup)
   */
  async performIncrementalBackup(lastBackupTimestamp) {
    if (this.dbConfig.type === DB_TYPES.MONGODB) {
      return await this.backupMongoDBIncremental(lastBackupTimestamp);
    }
    
    // For SQL databases, incremental backup typically requires binary logs
    // This is a simplified version that just backs up changed data based on timestamp
    throw new Error('Incremental backup is primarily supported for MongoDB. Use differential backup for SQL databases.');
  }

  /**
   * MongoDB incremental backup based on last timestamp
   */
  async backupMongoDBIncremental(lastBackupTimestamp) {
    const connection = await createConnection(this.dbConfig);
    const client = await connection.getConnection();

    try {
      const db = client.db(this.dbConfig.database);
      const collections = await db.listCollections().toArray();
      
      const backupData = {
        metadata: {
          type: 'mongodb_incremental',
          database: this.dbConfig.database,
          timestamp: new Date().toISOString(),
          since: lastBackupTimestamp,
          collectionsCount: collections.length
        },
        data: {}
      };

      // For each collection, find documents modified after lastBackupTimestamp
      // This requires documents to have an updatedAt field
      for (const collectionInfo of collections) {
        const collectionName = collectionInfo.name;
        const collection = db.collection(collectionName);
        
        // Find documents updated after the last backup
        const query = {
          updatedAt: { $gt: new Date(lastBackupTimestamp) }
        };
        
        const documents = await collection.find(query).toArray();
        backupData.data[collectionName] = documents;
      }

      const backupDir = this.options.backupDir || './backups';
      const filename = this.generateBackupFilename();
      const filePath = path.join(backupDir, filename);
      
      await fs.writeJson(filePath, backupData, { spaces: 2 });
      await connection.close();

      // Compress if enabled
      if (this.options.compression !== false) {
        return await this.compressFile(filePath);
      }

      return { success: true, filePath };
    } catch (error) {
      await connection.close();
      throw error;
    }
  }
}

/**
 * Create a backup manager instance
 */
const createBackupManager = (dbConfig, options = {}, logger = null) => {
  return new BackupManager(dbConfig, options, logger);
};

module.exports = {
  BackupManager,
  createBackupManager
};