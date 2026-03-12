const { DatabaseConnection, createConnection } = require('../src/database/connection');
const { DB_TYPES } = require('../src/config/constants');

describe('DatabaseConnection', () => {
  describe('validateParams', () => {
    it('should validate MySQL connection parameters', () => {
      const config = {
        type: DB_TYPES.MYSQL,
        host: 'localhost',
        port: 3306,
        username: 'root',
        password: 'password',
        database: 'testdb'
      };

      const connection = createConnection(config);
      const validation = connection.validateParams();

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should validate PostgreSQL connection parameters', () => {
      const config = {
        type: DB_TYPES.POSTGRESQL,
        host: 'localhost',
        port: 5432,
        username: 'postgres',
        password: 'password',
        database: 'testdb'
      };

      const connection = createConnection(config);
      const validation = connection.validateParams();

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should validate MongoDB connection parameters', () => {
      const config = {
        type: DB_TYPES.MONGODB,
        host: 'localhost',
        port: 27017,
        username: 'admin',
        password: 'password',
        database: 'testdb'
      };

      const connection = createConnection(config);
      const validation = connection.validateParams();

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should validate SQLite connection parameters', () => {
      const config = {
        type: DB_TYPES.SQLITE,
        filePath: '/path/to/database.sqlite'
      };

      const connection = createConnection(config);
      const validation = connection.validateParams();

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should reject invalid database type', () => {
      const config = {
        type: 'invalid',
        host: 'localhost',
        database: 'testdb'
      };

      const connection = createConnection(config);
      const validation = connection.validateParams();

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    it('should reject missing required parameters', () => {
      const config = {
        type: DB_TYPES.MYSQL
      };

      const connection = createConnection(config);
      const validation = connection.validateParams();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Host is required');
      expect(validation.errors).toContain('Database name is required');
      expect(validation.errors).toContain('Username is required');
    });
  });

  describe('getConnectionConfig', () => {
    it('should generate correct MySQL config', () => {
      const config = {
        type: DB_TYPES.MYSQL,
        host: 'localhost',
        port: 3306,
        username: 'root',
        password: 'password',
        database: 'testdb'
      };

      const connection = createConnection(config);
      const connConfig = connection.getConnectionConfig();

      expect(connConfig.type).toBe(DB_TYPES.MYSQL);
      expect(connConfig.host).toBe('localhost');
      expect(connConfig.port).toBe(3306);
      expect(connConfig.user).toBe('root');
      expect(connConfig.password).toBe('password');
      expect(connConfig.database).toBe('testdb');
    });

    it('should apply default port for MySQL', () => {
      const config = {
        type: DB_TYPES.MYSQL,
        host: 'localhost',
        username: 'root',
        password: 'password',
        database: 'testdb'
      };

      const connection = createConnection(config);
      const connConfig = connection.getConnectionConfig();

      expect(connConfig.port).toBe(3306);
    });

    it('should generate correct SQLite config', () => {
      const config = {
        type: DB_TYPES.SQLITE,
        filePath: '/path/to/database.sqlite'
      };

      const connection = createConnection(config);
      const connConfig = connection.getConnectionConfig();

      expect(connConfig.type).toBe(DB_TYPES.SQLITE);
      expect(connConfig.filename).toBe('/path/to/database.sqlite');
    });
  });

  describe('createConnection', () => {
    it('should return DatabaseConnection instance', () => {
      const config = {
        type: DB_TYPES.MYSQL,
        host: 'localhost',
        username: 'root',
        password: 'password',
        database: 'testdb'
      };

      const connection = createConnection(config);

      expect(connection).toBeInstanceOf(DatabaseConnection);
      expect(connection.type).toBe(DB_TYPES.MYSQL);
    });
  });
});