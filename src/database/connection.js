const { DB_TYPES, DEFAULT_PORTS, MESSAGES } = require('../config/constants');

/**
 * Database connection manager for various DBMS types
 */
class DatabaseConnection {
  constructor(config) {
    this.config = config;
    this.connection = null;
    this.type = config.type;
  }

  /**
   * Validate connection parameters
   */
  validateParams() {
    const errors = [];

    if (!this.config.type) {
      errors.push('Database type is required');
    }

    if (!Object.values(DB_TYPES).includes(this.config.type)) {
      errors.push(`Invalid database type: ${this.config.type}. Supported types: ${Object.values(DB_TYPES).join(', ')}`);
    }

    if (this.config.type !== DB_TYPES.SQLITE) {
      if (!this.config.host) {
        errors.push('Host is required');
      }
      if (!this.config.database) {
        errors.push('Database name is required');
      }
      if (!this.config.username) {
        errors.push('Username is required');
      }
    } else {
      // SQLite specific validation
      if (!this.config.filePath) {
        errors.push('File path is required for SQLite');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get normalized connection configuration
   */
  getConnectionConfig() {
    const baseConfig = {
      type: this.config.type
    };

    switch (this.config.type) {
      case DB_TYPES.MYSQL:
        return {
          ...baseConfig,
          host: this.config.host || 'localhost',
          port: this.config.port || DEFAULT_PORTS[DB_TYPES.MYSQL],
          user: this.config.username,
          password: this.config.password,
          database: this.config.database,
          charset: this.config.charset || 'utf8mb4',
          ssl: this.config.ssl
        };

      case DB_TYPES.POSTGRESQL:
        return {
          ...baseConfig,
          host: this.config.host || 'localhost',
          port: this.config.port || DEFAULT_PORTS[DB_TYPES.POSTGRESQL],
          user: this.config.username,
          password: this.config.password,
          database: this.config.database,
          ssl: this.config.ssl ? { rejectUnauthorized: false } : false
        };

      case DB_TYPES.MONGODB:
        const authSource = this.config.authSource || 'admin';
        const uri = this.config.uri || 
          `mongodb://${this.config.username}:${this.config.password}@${this.config.host || 'localhost'}:${this.config.port || DEFAULT_PORTS[DB_TYPES.MONGODB]}/${this.config.database}?authSource=${authSource}`;
        return {
          ...baseConfig,
          uri,
          host: this.config.host || 'localhost',
          port: this.config.port || DEFAULT_PORTS[DB_TYPES.MONGODB],
          database: this.config.database,
          options: {
            authSource,
            ...this.config.options
          }
        };

      case DB_TYPES.SQLITE:
        return {
          ...baseConfig,
          filename: this.config.filePath
        };

      default:
        return baseConfig;
    }
  }

  /**
   * Test connection to the database
   */
  async testConnection() {
    const validation = this.validateParams();
    if (!validation.valid) {
      throw new Error(`Connection validation failed: ${validation.errors.join(', ')}`);
    }

    try {
      switch (this.config.type) {
        case DB_TYPES.MYSQL:
          return await this.testMySQLConnection();
        case DB_TYPES.POSTGRESQL:
          return await this.testPostgreSQLConnection();
        case DB_TYPES.MONGODB:
          return await this.testMongoDBConnection();
        case DB_TYPES.SQLITE:
          return await this.testSQLiteConnection();
        default:
          throw new Error(MESSAGES.INVALID_DB_TYPE);
      }
    } catch (error) {
      throw new Error(`${MESSAGES.CONNECTION_FAILED}: ${error.message}`);
    }
  }

  /**
   * Test MySQL connection
   */
  async testMySQLConnection() {
    const mysql = require('mysql2/promise');
    const config = this.getConnectionConfig();
    
    try {
      const connection = await mysql.createConnection({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        charset: config.charset
      });
      
      await connection.ping();
      await connection.end();
      
      return { success: true, message: MESSAGES.CONNECTION_SUCCESS };
    } catch (error) {
      throw new Error(`MySQL connection failed: ${error.message}`);
    }
  }

  /**
   * Test PostgreSQL connection
   */
  async testPostgreSQLConnection() {
    const { Client } = require('pg');
    const config = this.getConnectionConfig();
    
    const client = new Client({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl
    });

    try {
      await client.connect();
      await client.end();
      
      return { success: true, message: MESSAGES.CONNECTION_SUCCESS };
    } catch (error) {
      throw new Error(`PostgreSQL connection failed: ${error.message}`);
    }
  }

  /**
   * Test MongoDB connection
   */
  async testMongoDBConnection() {
    const { MongoClient } = require('mongodb');
    const config = this.getConnectionConfig();
    
    const client = new MongoClient(config.uri, {
      connectTimeoutMS: 10000,
      socketTimeoutMS: 10000
    });

    try {
      await client.connect();
      await client.db().command({ ping: 1 });
      await client.close();
      
      return { success: true, message: MESSAGES.CONNECTION_SUCCESS };
    } catch (error) {
      throw new Error(`MongoDB connection failed: ${error.message}`);
    }
  }

  /**
   * Test SQLite connection
   */
  async testSQLiteConnection() {
    const sqlite3 = require('sqlite3').verbose();
    const config = this.getConnectionConfig();
    
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(config.filename, (err) => {
        if (err) {
          reject(new Error(`SQLite connection failed: ${err.message}`));
        } else {
          db.close((closeErr) => {
            if (closeErr) {
              reject(new Error(`SQLite close failed: ${closeErr.message}`));
            } else {
              resolve({ success: true, message: MESSAGES.CONNECTION_SUCCESS });
            }
          });
        }
      });
    });
  }

  /**
   * Get connection instance for operations
   */
  async getConnection() {
    switch (this.config.type) {
      case DB_TYPES.MYSQL:
        return await this.getMySQLConnection();
      case DB_TYPES.POSTGRESQL:
        return await this.getPostgreSQLConnection();
      case DB_TYPES.MONGODB:
        return await this.getMongoDBConnection();
      case DB_TYPES.SQLITE:
        return await this.getSQLiteConnection();
      default:
        throw new Error(MESSAGES.INVALID_DB_TYPE);
    }
  }

  /**
   * Get MySQL connection
   */
  async getMySQLConnection() {
    const mysql = require('mysql2/promise');
    const config = this.getConnectionConfig();
    
    this.connection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      charset: config.charset
    });
    
    return this.connection;
  }

  /**
   * Get PostgreSQL connection
   */
  async getPostgreSQLConnection() {
    const { Client } = require('pg');
    const config = this.getConnectionConfig();
    
    this.connection = new Client({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl
    });
    
    await this.connection.connect();
    return this.connection;
  }

  /**
   * Get MongoDB connection
   */
  async getMongoDBConnection() {
    const { MongoClient } = require('mongodb');
    const config = this.getConnectionConfig();
    
    this.connection = new MongoClient(config.uri);
    await this.connection.connect();
    
    return this.connection;
  }

  /**
   * Get SQLite connection
   */
  async getSQLiteConnection() {
    const sqlite3 = require('sqlite3').verbose();
    const sqlite = require('sqlite');
    const config = this.getConnectionConfig();
    
    this.connection = await sqlite.open({
      filename: config.filename,
      driver: sqlite3.Database
    });
    
    return this.connection;
  }

  /**
   * Close the connection
   */
  async close() {
    if (this.connection) {
      try {
        switch (this.config.type) {
          case DB_TYPES.MYSQL:
            await this.connection.end();
            break;
          case DB_TYPES.POSTGRESQL:
          case DB_TYPES.SQLITE:
            await this.connection.end();
            break;
          case DB_TYPES.MONGODB:
            await this.connection.close();
            break;
        }
        this.connection = null;
      } catch (error) {
        // Log error but don't throw
        console.warn(`Warning: Error closing connection: ${error.message}`);
      }
    }
  }
}

/**
 * Create a database connection instance
 */
const createConnection = (config) => {
  return new DatabaseConnection(config);
};

module.exports = {
  DatabaseConnection,
  createConnection
};