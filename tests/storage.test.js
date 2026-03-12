const { LocalStorage, StorageManager, createStorageManager } = require('../src/storage/storage');
const { STORAGE_TYPES } = require('../src/config/constants');
const fs = require('fs-extra');
const path = require('path');

describe('LocalStorage', () => {
  const testBackupDir = './test-backups';
  
  beforeEach(async () => {
    await fs.ensureDir(testBackupDir);
  });

  afterEach(async () => {
    await fs.remove(testBackupDir);
  });

  describe('initialize', () => {
    it('should create backup directory', async () => {
      const storage = new LocalStorage({ backupDir: testBackupDir });
      await storage.initialize();
      
      const exists = await fs.pathExists(testBackupDir);
      expect(exists).toBe(true);
    });
  });

  describe('list', () => {
    it('should list backups in directory', async () => {
      const storage = new LocalStorage({ backupDir: testBackupDir });
      
      // Create test files
      await fs.writeFile(path.join(testBackupDir, 'test1.sql'), 'content1');
      await fs.writeFile(path.join(testBackupDir, 'test2.sql'), 'content2');
      
      const backups = await storage.list();
      
      expect(backups).toHaveLength(2);
      expect(backups.map(b => b.filename)).toContain('test1.sql');
      expect(backups.map(b => b.filename)).toContain('test2.sql');
    });

    it('should return empty array when no backups', async () => {
      const storage = new LocalStorage({ backupDir: testBackupDir });
      const backups = await storage.list();
      
      expect(backups).toHaveLength(0);
    });
  });

  describe('save', () => {
    it('should save file to backup directory', async () => {
      const storage = new LocalStorage({ backupDir: testBackupDir });
      const testFile = path.join(testBackupDir, 'source.sql');
      
      await fs.writeFile(testFile, 'test content');
      const result = await storage.save(testFile, 'saved.sql');
      
      expect(result.success).toBe(true);
      expect(result.storageType).toBe(STORAGE_TYPES.LOCAL);
      
      const savedContent = await fs.readFile(path.join(testBackupDir, 'saved.sql'), 'utf8');
      expect(savedContent).toBe('test content');
    });
  });

  describe('delete', () => {
    it('should delete file from backup directory', async () => {
      const storage = new LocalStorage({ backupDir: testBackupDir });
      
      await fs.writeFile(path.join(testBackupDir, 'to-delete.sql'), 'content');
      const existsBefore = await fs.pathExists(path.join(testBackupDir, 'to-delete.sql'));
      expect(existsBefore).toBe(true);
      
      await storage.delete('to-delete.sql');
      
      const existsAfter = await fs.pathExists(path.join(testBackupDir, 'to-delete.sql'));
      expect(existsAfter).toBe(false);
    });
  });

  describe('getStorageInfo', () => {
    it('should return storage information', async () => {
      const storage = new LocalStorage({ backupDir: testBackupDir, retention: 7 });
      
      await fs.writeFile(path.join(testBackupDir, 'test.sql'), 'content');
      
      const info = await storage.getStorageInfo();
      
      expect(info.storageType).toBe(STORAGE_TYPES.LOCAL);
      expect(info.backupDirectory).toBe(testBackupDir);
      expect(info.retentionDays).toBe(7);
      expect(info.totalBackups).toBe(1);
      expect(info.totalSize).toBeGreaterThan(0);
    });
  });

  describe('applyRetentionPolicy', () => {
    it('should delete old backups based on retention days', async () => {
      const storage = new LocalStorage({ backupDir: testBackupDir, retention: 1 });
      
      // Create an old file (modify birthtime)
      const oldFile = path.join(testBackupDir, 'old-backup.sql');
      await fs.writeFile(oldFile, 'old content');
      const oldTime = new Date();
      oldTime.setDate(oldTime.getDate() - 5); // 5 days ago
      await fs.utimes(oldFile, oldTime, oldTime);
      
      // Create a new file
      await fs.writeFile(path.join(testBackupDir, 'new-backup.sql'), 'new content');
      
      const deleted = await storage.applyRetentionPolicy(1);
      
      expect(deleted).toContain('old-backup.sql');
      expect(deleted).not.toContain('new-backup.sql');
      
      const newFileExists = await fs.pathExists(path.join(testBackupDir, 'new-backup.sql'));
      expect(newFileExists).toBe(true);
      
      const oldFileExists = await fs.pathExists(path.join(testBackupDir, 'old-backup.sql'));
      expect(oldFileExists).toBe(false);
    });
  });
});

describe('StorageManager', () => {
  describe('getProvider', () => {
    it('should return LocalStorage for local type', () => {
      const manager = new StorageManager({ type: STORAGE_TYPES.LOCAL });
      const provider = manager.getProvider();
      
      expect(provider).toBeInstanceOf(LocalStorage);
    });

    it('should throw error for invalid storage type', () => {
      const manager = new StorageManager({ type: 'invalid' });
      
      expect(() => manager.getProvider()).toThrow();
    });
  });

  describe('createStorageManager', () => {
    it('should create StorageManager instance', () => {
      const manager = createStorageManager({ type: STORAGE_TYPES.LOCAL });
      
      expect(manager).toBeInstanceOf(StorageManager);
    });
  });
});