import { describe, it, test, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

import {
  ConfigLoader as LegacyConfigLoader,
  createConfigLoader as legacyCreateConfigLoader,
  loadConfig as legacyLoadConfig,
} from '../../src/config/loader.js';
import {
  ConfigLoader as UnifiedConfigLoader,
  createConfigLoader as unifiedCreateConfigLoader,
  loadConfig as unifiedLoadConfig,
} from '../../src/config/configLoader.js';
import { configSchema as legacyConfigSchema } from '../../src/config/schema.js';
import { configSchema as unifiedConfigSchema } from '../../src/config/configValidator.js';

describe('legacy config compatibility exports', () => {
  test('legacy loader exports point to unified implementation', () => {
    const legacyLoader = new LegacyConfigLoader();

    expect(legacyLoader).toBeInstanceOf(UnifiedConfigLoader);
    expect(legacyLoadConfig).toBe(unifiedLoadConfig);
    expect(legacyCreateConfigLoader).toBe(unifiedCreateConfigLoader);
  });

  test('legacy schema export is unified schema', () => {
    expect(legacyConfigSchema).toBe(unifiedConfigSchema);
  });
});
