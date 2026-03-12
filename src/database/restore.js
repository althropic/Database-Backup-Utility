const { DB_TYPES, MESSAGES } = require('../config/constants');
const { createConnection } = require('./connection');
const { logRestoreStart, logRestoreComplete, logRestoreError } = require('../utils/logger');
const path = require('path');
const fs = require('fs-extra');
const zlib = require('zlib');

/**
 * Restore manager for various database types
 */
class RestoreManager {
  constructor(dbConfig, options = {}, logger = null) {
    this.dbConfig = dbConfig;
    this.options = options;
    this.logger = logger;
    this.startTime = null;
  }

  /**
   * Decompress a gzipped backup file
   */
  async decompressFile(filePath) {
    if (!filePath.endsWith('.gz')) {
      return filePath;
    }

    const decompressedPath = filePath.replace('.gz', '');
    
    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(filePath);
      const gunzip = zlib.createGunzip();
      const writeStream = fs.createWriteStream(decompressedPath);

      readStream
        .pipe(gunzip)
        .pipe(writeStream)
        .on('finish', () => {
          resolve(decompressedPath);
        })
        .on('error', reject);
    });
  }

  /**
   * Perform restore operation
   */
  async performRestore(filePath) {
    this.startTime = Date.now();
    
    try {
      // Check if file exists
      if (!await fs.pathExists(filePath)) {
        throw new Error(MESSAGES.FILE_NOT_FOUND);
      }

      // Decompress if needed
      let restorePath = filePath;
      if (filePath.endsWith('.gz')) {
        restorePath = await this.decompressFile(filePath);
      }

      // Log restore start
      if (this.logger) {
        logRestoreStart(this.logger, {
          databaseType: this.dbConfig.type,
          databaseName: this.dbConfig.database || this.dbConfig.filePath,
          filePath
        });
      }

      let result;

      switch (this.dbConfig.type) {
        case DB_TYPES.MYSQL:
          result = await this.restoreMySQL(restorePath);
          break;
        case DB_TYPES.POSTGRESQL:
          result = await this.restorePostgreSQL(restorePath);
          break;
        case DB_TYPES.MONGODB:
          result = await this.restoreMongoDB(restorePath);
          break;
        case DB_TYPES.SQLITE:
          result = await this.restoreSQLite(restorePath);
          break;
        default:
          throw new Error(MESSAGES.INVALID_DB_TYPE);
      }

      const duration = Date.now() - this.startTime;

      // Cleanup decompressed file if we created it
      if (restorePath !== filePath) {
        await fs.remove(restorePath);
      }

      // Log restore completion
      if (this.logger) {
        logRestoreComplete(this.logger, {
          databaseType: this.dbConfig.type,
          databaseName: this.dbConfig.database || this.dbConfig.filePath,
          filePath,
          duration
        });
      }

      return {
        success: true,
        filePath,
        duration,
        ...result
      };

    } catch (error) {
      const duration = Date.now() - this.startTime;

      // Log restore error
      if (this.logger) {
        logRestoreError(this.logger, {
          databaseType: this.dbConfig.type,
          databaseName: this.dbConfig.database || this.dbConfig.filePath,
          filePath,
          error,
          duration
        });
      }

      throw error;
    }
  }

  /**
   * Restore MySQL database from backup file
   */
  async restoreMySQL(filePath) {
    const connection = await createConnection(this.dbConfig);
    const conn = await connection.getConnection();

    try {
      const sqlContent = await fs.readFile(filePath, 'utf8');
      
      // Split SQL content into individual statements
      const statements = sqlContent
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      // Execute each statement
      for (const statement of statements) {
        try {
          await conn.query(statement);
        } catch (err) {
          // Log warning but continue
          console.warn(`Warning: Error executing statement: ${err.message}`);
        }
      }

      await connection.close();

      return { success: true, tablesRestored: statements.length };
    } catch (error) {
      await connection.close();
      throw error;
    }
  }

  /**
   * Restore PostgreSQL database from backup file
   */
  async restorePostgreSQL(filePath) {
    const connection = await createConnection(this.dbConfig);
    const client = await connection.getConnection();

    try {
      const sqlContent = await fs.readFile(filePath, 'utf8');
      
      // Split SQL content into individual statements
      const statements = sqlContent
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      // Execute each statement
      for (const statement of statements) {
        try {
          await client.query(statement);
        } catch (err) {
          // Log warning but continue
          console.warn(`Warning: Error executing statement: ${err.message}`);
        }
      }

      await connection.close();

      return { success: true, statementsExecuted: statements.length };
    } catch (error) {
      await connection.close();
      throw error;
    }
  }

  /**
   * Restore MongoDB database from backup file
   */
  async restoreMongoDB(filePath) {
    const connection = await createConnection(this.dbConfig);
    const client = await connection.getConnection();

    try {
      const backupData = await fs.readJson(filePath);
      const db = client.db(this.dbConfig.database);
      
      let collectionsRestored = 0;
      let documentsRestored = 0;

      // Check if this is selective restore
      const selectiveCollections = this.options.collections || null;

      for (const [collectionName, documents] of Object.entries(backupData.data)) {
        // Skip if selective restore and collection not in list
        if (selectiveCollections && !selectiveCollections.includes(collectionName)) {
          continue;
        }

        if (documents.length > 0) {
          const collection = db.collection(collectionName);
          
          // Drop existing collection if option set
          if (this.options.dropCollections) {
            try {
              await collection.drop();
            } catch {
              // Collection may not exist
            }
          }

          // Insert documents
          const result = await collection.insertMany(documents);
          documentsRestored += result.insertedCount;
          collectionsRestored++;
        }
      }

      await connection.close();

      return {
        success: true,
        collectionsRestored,
        documentsRestored
      };
    } catch (error) {
      await connection.close();
      throw error;
    }
  }

  /**
   * Restore SQLite database from backup file
   */
  async restoreSQLite(filePath) {
    const connection = await createConnection(this.dbConfig);
    const db = await connection.getConnection();

    try {
      const sqlContent = await fs.readFile(filePath, 'utf8');
      
      // Split SQL content into individual statements
      const statements = sqlContent
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      // Execute each statement
      for (const statement of statements) {
        try {
          await db.run(statement);
        } catch (err) {
          // Log warning but continue
          console.warn(`Warning: Error executing statement: ${err.message}`);
        }
      }

      await connection.close();

      return { success: true, statementsExecuted: statements.length };
    } catch (error) {
      await connection.close();
      throw error;
    }
  }

  /**
   * Selective restore from backup
   */
  async performSelectiveRestore(filePath, tables) {
    this.startTime = Date.now();

    try {
      // Check if file exists
      if (!await fs.pathExists(filePath)) {
        throw new Error(MESSAGES.FILE_NOT_FOUND);
      }

      // Decompress if needed
      let restorePath = filePath;
      if (filePath.endsWith('.gz')) {
        restorePath = await this.decompressFile(filePath);
      }

      // Log restore start
      if (this.logger) {
        logRestoreStart(this.logger, {
          databaseType: this.dbConfig.type,
          databaseName: this.dbConfig.database || this.dbConfig.filePath,
          filePath
        });
      }

      let result;

      // MongoDB selective restore is handled differently
      if (this.dbConfig.type === DB_TYPES.MONGODB) {
        result = await this.restoreMongoDB(restorePath);
      } else {
        // For SQL databases, parse and restore only specified tables
        result = await this.restoreSQLSelective(restorePath, tables);
      }

      const duration = Date.now() - this.startTime;

      // Cleanup decompressed file if we created it
      if (restorePath !== filePath) {
        await fs.remove(restorePath);
      }

      // Log restore completion
      if (this.logger) {
        logRestoreComplete(this.logger, {
          databaseType: this.dbConfig.type,
          databaseName: this.dbConfig.database || this.dbConfig.filePath,
          filePath,
          duration
        });
      }

      return {
        success: true,
        filePath,
        duration,
        tablesRestored: tables,
        ...result
      };

    } catch (error) {
      const duration = Date.now() - this.startTime;

      // Log restore error
      if (this.logger) {
        logRestoreError(this.logger, {
          databaseType: this.dbConfig.type,
          databaseName: this.dbConfig.database || this.dbConfig.filePath,
          filePath,
          error,
          duration
        });
      }

      throw error;
    }
  }

  /**
   * Selective restore for SQL databases
   */
  async restoreSQLSelective(filePath, tables) {
    const sqlContent = await fs.readFile(filePath, 'utf8');
    
    // Parse SQL content to extract table-specific statements
    const tableStatements = this.parseSQLForTables(sqlContent, tables);
    
    const connection = await createConnection(this.dbConfig);
    let conn;
    
    if (this.dbConfig.type === DB_TYPES.MYSQL) {
      conn = await connection.getConnection();
    } else if (this.dbConfig.type === DB_TYPES.POSTGRESQL) {
      conn = await connection.getConnection();
    }

    try {
      let statementsExecuted = 0;

      for (const tableName of tables) {
        const statements = tableStatements[tableName] || [];
        
        for (const statement of statements) {
          try {
            if (this.dbConfig.type === DB_TYPES.MYSQL) {
              await conn.query(statement);
            } else {
              await conn.query(statement);
            }
            statementsExecuted++;
          } catch (err) {
            console.warn(`Warning: Error executing statement: ${err.message}`);
          }
        }
      }

      await connection.close();

      return {
        success: true,
        tablesRestored: tables,
        statementsExecuted
      };
    } catch (error) {
      await connection.close();
      throw error;
    }
  }

  /**
   * Parse SQL content for specific tables
   */
  parseSQLForTables(sqlContent, tables) {
    const result = {};
    
    // Split into lines and process
    const lines = sqlContent.split('\n');
    let currentTable = null;
    let currentStatements = [];

    for (const line of lines) {
      // Check for table references in CREATE TABLE
      const createMatch = line.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?/i);
      if (createMatch) {
        if (currentTable && tables.includes(currentTable)) {
          result[currentTable] = [...currentStatements];
        }
        currentTable = createMatch[1].toLowerCase().replace(/[`"]/g, '');
        currentStatements = [];
      }

      // Check for DROP TABLE
      const dropMatch = line.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"]?(\w+)[`"]?/i);
      if (dropMatch) {
        const tableName = dropMatch[1].toLowerCase().replace(/[`"]/g, '');
        if (tables.includes(tableName)) {
          if (!result[tableName]) {
            result[tableName] = [];
          }
          result[tableName].push(line + ';');
        }
      }

      // Check for INSERT statements
      const insertMatch = line.match(/INSERT\s+INTO\s+[`"]?(\w+)[`"]?/i);
      if (insertMatch) {
        const tableName = insertMatch[1].toLowerCase().replace(/[`"]/g, '');
        if (tables.includes(tableName)) {
          if (!result[tableName]) {
            result[tableName] = [];
          }
          result[tableName].push(line + ';');
        }
      }

      // Accumulate statements for current table
      if (currentTable && tables.includes(currentTable)) {
        if (line.trim().startsWith('--') || line.trim().length === 0) {
          continue;
        }
        if (line.includes(';')) {
          currentStatements.push(line);
        }
      }
    }

    // Save last table
    if (currentTable && tables.includes(currentTable)) {
      result[currentTable] = [...currentStatements];
    }

    return result;
  }

  /**
   * List available backups
   */
  static async listBackups(backupDir) {
    const files = await fs.readdir(backupDir);
    const backups = [];

    for (const file of files) {
      const filePath = path.join(backupDir, file);
      const stats = await fs.stat(filePath);

      backups.push({
        filename: file,
        path: filePath,
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime
      });
    }

    return backups.sort((a, b) => b.modified - a.modified);
  }

  /**
   * Get backup info
   */
  static async getBackupInfo(filePath) {
    if (!await fs.pathExists(filePath)) {
      return null;
    }

    const stats = await fs.stat(filePath);
    const ext = path.extname(filePath);
    const compressed = ext === '.gz';

    return {
      path: filePath,
      filename: path.basename(filePath),
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      compressed
    };
  }
}

/**
 * Create a restore manager instance
 */
const createRestoreManager = (dbConfig, options = {}, logger = null) => {
  return new RestoreManager(dbConfig, options, logger);
};

module.exports = {
  RestoreManager,
  createRestoreManager
};