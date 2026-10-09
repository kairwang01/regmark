export { ConfigError, runAudit, sample } from './audit.ts';
export type { AuditConfig, AuditDeps, ShipTo } from './audit.ts';
import type { AuditConfig } from './audit.ts';

/** Identity function, so a config file gets type checking and completion. */
export function defineConfig(config: AuditConfig): AuditConfig {
  return config;
}
