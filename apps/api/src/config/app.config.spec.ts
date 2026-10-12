import { validateConfig } from './app.config';

describe('validateConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      DATABASE_URL: 'postgresql://contextforge:contextforge_password@localhost:5432/contextforge?schema=public',
      REDIS_HOST: 'localhost',
      REDIS_PORT: '6379',
      REDIS_PASSWORD: '',
      QDRANT_HOST: 'localhost',
      QDRANT_PORT: '6333',
      QDRANT_HTTP_URL: 'http://localhost:6333',
      QDRANT_GRPC_PORT: '6334',
      QDRANT_HTTPS: 'false',
      EMBEDDING_BASE_URL: 'https://api.openai.com/v1',
      EMBEDDING_MODEL: 'text-embedding-3-small',
      EMBEDDING_DIMENSION: '1536',
      EMBEDDING_TIMEOUT_MS: '30000',
      EMBEDDING_API_KEY: '',
      ADMIN_API_KEY: '',
      API_KEY_AUTH_ENABLED: 'false',
      CORS_ORIGIN: '*',
      MANAGED_UPLOAD_STORAGE_DIR: '.contextforge/uploads',
      MANAGED_UPLOAD_MAX_ARCHIVE_BYTES: String(50 * 1024 * 1024),
      MANAGED_UPLOAD_MAX_EXTRACTED_BYTES: String(250 * 1024 * 1024),
      MANAGED_UPLOAD_MAX_FILES: '5000',
      URL_SOURCE_MAX_PAGES: '25',
      URL_SOURCE_MAX_BYTES_PER_PAGE: String(1024 * 1024),
      URL_SOURCE_TOTAL_MAX_BYTES: String(5 * 1024 * 1024),
      URL_SOURCE_TIMEOUT_MS: '10000',
      URL_SOURCE_SAME_HOST: 'true',
      URL_SOURCE_RESPECT_ROBOTS: 'true',
      NODE_ENV: 'test',
      PORT: '3000',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('allows disabled auth without an admin key', () => {
    expect(validateConfig()).toMatchObject({
      API_KEY_AUTH_ENABLED: false,
    });
  });

  it('rejects enabled auth without an admin key', () => {
    process.env.API_KEY_AUTH_ENABLED = 'true';
    process.env.ADMIN_API_KEY = '';

    expect(() => validateConfig()).toThrow('Invalid environment configuration');
  });

  it('accepts enabled auth with an admin key', () => {
    process.env.API_KEY_AUTH_ENABLED = 'true';
    process.env.ADMIN_API_KEY = 'secret';

    expect(validateConfig()).toMatchObject({
      API_KEY_AUTH_ENABLED: true,
      ADMIN_API_KEY: 'secret',
    });
  });

  it('rejects production without auth and narrow CORS', () => {
    process.env.NODE_ENV = 'production';
    process.env.API_KEY_AUTH_ENABLED = 'false';
    process.env.ADMIN_API_KEY = '';
    process.env.CORS_ORIGIN = '*';

    expect(() => validateConfig()).toThrow('Invalid environment configuration');
  });

  it('rejects production sentinel placeholders', () => {
    process.env.NODE_ENV = 'production';
    process.env.API_KEY_AUTH_ENABLED = 'true';
    process.env.ADMIN_API_KEY = '__REQUIRED_ADMIN_API_KEY__';
    process.env.CORS_ORIGIN = '__REQUIRED_CORS_ORIGIN__';

    expect(() => validateConfig()).toThrow('Invalid environment configuration');
  });

  it('accepts production with auth and explicit CORS origin', () => {
    process.env.NODE_ENV = 'production';
    process.env.API_KEY_AUTH_ENABLED = 'true';
    process.env.ADMIN_API_KEY = 'secret';
    process.env.CORS_ORIGIN = 'https://contextforge.example.com';

    expect(validateConfig()).toMatchObject({
      NODE_ENV: 'production',
      API_KEY_AUTH_ENABLED: true,
      CORS_ORIGIN: 'https://contextforge.example.com',
    });
  });

  it('exposes managed upload defaults', () => {
    expect(validateConfig()).toMatchObject({
      MANAGED_UPLOAD_STORAGE_DIR: '.contextforge/uploads',
      MANAGED_UPLOAD_MAX_ARCHIVE_BYTES: 50 * 1024 * 1024,
      MANAGED_UPLOAD_MAX_EXTRACTED_BYTES: 250 * 1024 * 1024,
      MANAGED_UPLOAD_MAX_FILES: 5000,
    });
  });

  it('exposes source trigger defaults', () => {
    expect(validateConfig()).toMatchObject({
      SOURCE_TRIGGER_SCHEDULER_ENABLED: false,
      SOURCE_TRIGGER_SCHEDULER_POLL_MS: 60000,
      SOURCE_TRIGGER_WATCH_ENABLED: false,
    });
  });

  it('exposes URL source defaults', () => {
    expect(validateConfig()).toMatchObject({
      URL_SOURCE_MAX_PAGES: 25,
      URL_SOURCE_MAX_BYTES_PER_PAGE: 1024 * 1024,
      URL_SOURCE_TOTAL_MAX_BYTES: 5 * 1024 * 1024,
      URL_SOURCE_TIMEOUT_MS: 10000,
      URL_SOURCE_SAME_HOST: true,
      URL_SOURCE_RESPECT_ROBOTS: true,
    });
  });
});
