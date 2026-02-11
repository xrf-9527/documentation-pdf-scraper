import {
  ConfigLoader as UnifiedConfigLoader,
  createConfigLoader as createUnifiedConfigLoader,
  loadConfig as loadUnifiedConfig,
} from './configLoader.js';

export class ConfigLoader extends UnifiedConfigLoader {}

export const loadConfig = loadUnifiedConfig;

export const createConfigLoader = createUnifiedConfigLoader;
