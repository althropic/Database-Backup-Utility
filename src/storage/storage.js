const { STORAGE_TYPES } = require('../config/constants');
const fs = require('fs-extra');
const path = require('path');

/**
 * Local storage provider
 */
class LocalStorage {
  constructor(config = {}) {
    this.backupDir = config.backupDir || './backups';
    this.retention = config.retention || 30; // days
  }

  /**
   * Initialize storage
   */
  async initialize() {
    await fs.ensureDir(this.backupDir);
  }

  /**
   * Save file to local storage
   */
  async save(filePath, fileName) {
    await this.initialize();
    const destinationPath = path.join(this.backupDir, fileName || path.basename(filePath));
    
    // Copy file to backup directory
    await fs.copy(filePath, destinationPath, { overwrite: true });
    
    return {
      success: true,
      path: destinationPath,
      storageType: STORAGE_TYPES.LOCAL
    };
  }

  /**
   * Retrieve file from local storage
   */
  async retrieve(fileName, destinationPath) {
    const sourcePath = path.join(this.backupDir, fileName);
    
    if (!await fs.pathExists(sourcePath)) {
      throw new Error(`Backup file not found: ${fileName}`);
    }
    
    if (destinationPath) {
      await fs.copy(sourcePath, destinationPath, { overwrite: true });
      return destinationPath;
    }
    
    return sourcePath;
  }

  /**
   * List all backups
   */
  async list() {
    await this.initialize();
    const files = await fs.readdir(this.backupDir);
    const backups = [];

    for (const file of files) {
      const filePath = path.join(this.backupDir, file);
      const stats = await fs.stat(filePath);

      backups.push({
        filename: file,
        path: filePath,
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        storageType: STORAGE_TYPES.LOCAL
      });
    }

    return backups.sort((a, b) => b.modified - a.modified);
  }

  /**
   * Delete a backup
   */
  async delete(fileName) {
    const filePath = path.join(this.backupDir, fileName);
    
    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath);
    }
    
    return { success: true };
  }

  /**
   * Apply retention policy
   */
  async applyRetentionPolicy(retentionDays = this.retention) {
    const backups = await this.list();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const deletedBackups = [];

    for (const backup of backups) {
      if (new Date(backup.modified) < cutoffDate) {
        await this.delete(backup.filename);
        deletedBackups.push(backup.filename);
      }
    }

    return deletedBackups;
  }

  /**
   * Get storage info
   */
  async getStorageInfo() {
    await this.initialize();
    
    const backups = await this.list();
    const totalSize = backups.reduce((sum, backup) => sum + backup.size, 0);
    
    return {
      storageType: STORAGE_TYPES.LOCAL,
      backupDirectory: this.backupDir,
      totalBackups: backups.length,
      totalSize: totalSize,
      retentionDays: this.retention
    };
  }
}

/**
 * AWS S3 storage provider
 */
class S3Storage {
  constructor(config = {}) {
    this.bucket = config.bucket;
    this.region = config.region || 'us-east-1';
    this.accessKeyId = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
    this.prefix = config.prefix || 'backups/';
    this.s3 = null;
  }

  /**
   * Initialize S3 client
   */
  async initialize() {
    const AWS = require('aws-sdk');
    
    this.s3 = new AWS.S3({
      region: this.region,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey
    });
  }

  /**
   * Save file to S3
   */
  async save(filePath, fileName) {
    await this.initialize();
    
    const fileContent = await fs.readFile(filePath);
    const key = `${this.prefix}${fileName || path.basename(filePath)}`;
    
    const params = {
      Bucket: this.bucket,
      Key: key,
      Body: fileContent
    };

    await this.s3.upload(params).promise();
    
    return {
      success: true,
      path: key,
      storageType: STORAGE_TYPES.S3,
      bucket: this.bucket
    };
  }

  /**
   * Retrieve file from S3
   */
  async retrieve(fileName, destinationPath) {
    await this.initialize();
    
    const key = `${this.prefix}${fileName}`;
    
    const params = {
      Bucket: this.bucket,
      Key: key
    };

    const data = await this.s3.getObject(params).promise();
    const destPath = destinationPath || path.join(process.cwd(), fileName);
    
    await fs.writeFile(destPath, data.Body);
    
    return destPath;
  }

  /**
   * List all backups
   */
  async list() {
    await this.initialize();
    
    const params = {
      Bucket: this.bucket,
      Prefix: this.prefix
    };

    const data = await this.s3.listObjectsV2(params).promise();
    
    return data.Contents
      .filter(item => item.Key !== this.prefix)
      .map(item => ({
        filename: path.basename(item.Key),
        path: item.Key,
        size: item.Size,
        modified: item.LastModified,
        storageType: STORAGE_TYPES.S3,
        bucket: this.bucket
      }))
      .sort((a, b) => b.modified - a.modified);
  }

  /**
   * Delete a backup
   */
  async delete(fileName) {
    await this.initialize();
    
    const key = `${this.prefix}${fileName}`;
    
    const params = {
      Bucket: this.bucket,
      Key: key
    };

    await this.s3.deleteObject(params).promise();
    
    return { success: true };
  }

  /**
   * Apply retention policy
   */
  async applyRetentionPolicy(retentionDays = 30) {
    const backups = await this.list();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.setDate() - retentionDays);

    const deletedBackups = [];

    for (const backup of backups) {
      if (new Date(backup.modified) < cutoffDate) {
        await this.delete(backup.filename);
        deletedBackups.push(backup.filename);
      }
    }

    return deletedBackups;
  }
}

/**
 * Google Cloud Storage provider
 */
class GCSStorage {
  constructor(config = {}) {
    this.bucket = config.bucket;
    this.projectId = config.projectId;
    this.keyFilename = config.keyFilename;
    this.prefix = config.prefix || 'backups/';
    this.storage = null;
  }

  /**
   * Initialize GCS client
   */
  async initialize() {
    const { Storage } = require('@google-cloud/storage');
    
    const storageConfig = {};
    if (this.projectId) storageConfig.projectId = this.projectId;
    if (this.keyFilename) storageConfig.keyFilename = this.keyFilename;
    
    this.storage = new Storage(storageConfig);
  }

  /**
   * Save file to GCS
   */
  async save(filePath, fileName) {
    await this.initialize();
    
    const bucket = this.storage.bucket(this.bucket);
    const destFileName = `${this.prefix}${fileName || path.basename(filePath)}`;
    const options = {
      destination: destFileName
    };

    await bucket.upload(filePath, options);
    
    return {
      success: true,
      path: destFileName,
      storageType: STORAGE_TYPES.GCS,
      bucket: this.bucket
    };
  }

  /**
   * Retrieve file from GCS
   */
  async retrieve(fileName, destinationPath) {
    await this.initialize();
    
    const bucket = this.storage.bucket(this.bucket);
    const file = bucket.file(`${this.prefix}${fileName}`);
    const destPath = destinationPath || path.join(process.cwd(), fileName);
    
    await file.download({ destination: destPath });
    
    return destPath;
  }

  /**
   * List all backups
   */
  async list() {
    await this.initialize();
    
    const bucket = this.storage.bucket(this.bucket);
    const [files] = await bucket.getFiles({ prefix: this.prefix });
    
    return files
      .filter(file => file.name !== this.prefix)
      .map(file => ({
        filename: path.basename(file.name),
        path: file.name,
        size: parseInt(file.metadata.size),
        modified: new Date(file.metadata.updated),
        storageType: STORAGE_TYPES.GCS,
        bucket: this.bucket
      }))
      .sort((a, b) => b.modified - a.modified);
  }

  /**
   * Delete a backup
   */
  async delete(fileName) {
    await this.initialize();
    
    const bucket = this.storage.bucket(this.bucket);
    const file = bucket.file(`${this.prefix}${fileName}`);
    
    await file.delete();
    
    return { success: true };
  }

  /**
   * Apply retention policy
   */
  async applyRetentionPolicy(retentionDays = 30) {
    const backups = await this.list();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const deletedBackups = [];

    for (const backup of backups) {
      if (new Date(backup.modified) < cutoffDate) {
        await this.delete(backup.filename);
        deletedBackups.push(backup.filename);
      }
    }

    return deletedBackups;
  }
}

/**
 * Azure Blob Storage provider
 */
class AzureStorage {
  constructor(config = {}) {
    this.connectionString = config.connectionString;
    this.containerName = config.containerName;
    this.prefix = config.prefix || 'backups/';
    this.containerClient = null;
  }

  /**
   * Initialize Azure Blob Storage client
   */
  async initialize() {
    const { BlobServiceClient } = require('@azure/storage-blob');
    
    const blobServiceClient = BlobServiceClient.fromConnectionString(this.connectionString);
    this.containerClient = blobServiceClient.getContainerClient(this.containerName);
    
    // Create container if it doesn't exist
    await this.containerClient.createIfNotExists();
  }

  /**
   * Save file to Azure Blob Storage
   */
  async save(filePath, fileName) {
    await this.initialize();
    
    const blockBlobClient = this.containerClient.getBlockBlobClient(
      `${this.prefix}${fileName || path.basename(filePath)}`
    );
    
    await blockBlobClient.uploadFile(filePath);
    
    return {
      success: true,
      path: `${this.prefix}${fileName || path.basename(filePath)}`,
      storageType: STORAGE_TYPES.AZURE,
      container: this.containerName
    };
  }

  /**
   * Retrieve file from Azure Blob Storage
   */
  async retrieve(fileName, destinationPath) {
    await this.initialize();
    
    const blockBlobClient = this.containerClient.getBlockBlobClient(
      `${this.prefix}${fileName}`
    );
    const destPath = destinationPath || path.join(process.cwd(), fileName);
    
    await blockBlobClient.downloadToFile(destPath);
    
    return destPath;
  }

  /**
   * List all backups
   */
  async list() {
    await this.initialize();
    
    const backups = [];
    
    for await (const blob of this.containerClient.listBlobsFlat({ prefix: this.prefix })) {
      if (blob.name !== this.prefix) {
        backups.push({
          filename: path.basename(blob.name),
          path: blob.name,
          size: blob.properties.contentLength,
          modified: blob.properties.lastModified,
          storageType: STORAGE_TYPES.AZURE,
          container: this.containerName
        });
      }
    }
    
    return backups.sort((a, b) => b.modified - a.modified);
  }

  /**
   * Delete a backup
   */
  async delete(fileName) {
    await this.initialize();
    
    const blockBlobClient = this.containerClient.getBlockBlobClient(
      `${this.prefix}${fileName}`
    );
    
    await blockBlobClient.delete();
    
    return { success: true };
  }

  /**
   * Apply retention policy
   */
  async applyRetentionPolicy(retentionDays = 30) {
    const backups = await this.list();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const deletedBackups = [];

    for (const backup of backups) {
      if (new Date(backup.modified) < cutoffDate) {
        await this.delete(backup.filename);
        deletedBackups.push(backup.filename);
      }
    }

    return deletedBackups;
  }
}

/**
 * Storage manager factory
 */
class StorageManager {
  constructor(config) {
    this.config = config;
    this.provider = null;
  }

  /**
   * Get storage provider based on type
   */
  getProvider() {
    if (this.provider) {
      return this.provider;
    }

    switch (this.config.type) {
      case STORAGE_TYPES.LOCAL:
        this.provider = new LocalStorage(this.config);
        break;
      case STORAGE_TYPES.S3:
        this.provider = new S3Storage(this.config);
        break;
      case STORAGE_TYPES.GCS:
        this.provider = new GCSStorage(this.config);
        break;
      case STORAGE_TYPES.AZURE:
        this.provider = new AzureStorage(this.config);
        break;
      default:
        throw new Error(`Unsupported storage type: ${this.config.type}`);
    }

    return this.provider;
  }

  /**
   * Save backup to storage
   */
  async save(filePath, fileName) {
    const provider = this.getProvider();
    return await provider.save(filePath, fileName);
  }

  /**
   * Retrieve backup from storage
   */
  async retrieve(fileName, destinationPath) {
    const provider = this.getProvider();
    return await provider.retrieve(fileName, destinationPath);
  }

  /**
   * List backups
   */
  async list() {
    const provider = this.getProvider();
    return await provider.list();
  }

  /**
   * Delete backup
   */
  async delete(fileName) {
    const provider = this.getProvider();
    return await provider.delete(fileName);
  }

  /**
   * Apply retention policy
   */
  async applyRetentionPolicy(retentionDays) {
    const provider = this.getProvider();
    return await provider.applyRetentionPolicy(retentionDays);
  }

  /**
   * Get storage info
   */
  async getStorageInfo() {
    const provider = this.getProvider();
    if (provider.getStorageInfo) {
      return await provider.getStorageInfo();
    }
    const backups = await provider.list();
    return {
      storageType: this.config.type,
      totalBackups: backups.length,
      totalSize: backups.reduce((sum, b) => sum + b.size, 0)
    };
  }
}

/**
 * Create storage manager instance
 */
const createStorageManager = (config) => {
  return new StorageManager(config);
};

module.exports = {
  StorageManager,
  LocalStorage,
  S3Storage,
  GCSStorage,
  AzureStorage,
  createStorageManager
};