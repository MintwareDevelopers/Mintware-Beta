// V1-10 fix (independent Codex audit, 2026-09-09): `pnpm lint` was declared in package.json but
// ESLint itself was never a dependency and no config existed — the command has presumably never run.
// Minimal, standard Next.js flat config; nothing stricter than the framework's own recommended rules
// is asserted here on day one.
import nextPlugin from 'eslint-config-next'

const eslintConfig = [
  ...nextPlugin,
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'contracts-v4/**',
      'contracts-ai/**',
      'services/**',
      'sdk/**',
      'plugins/**',
      '.claude/**',
      'tools/**',
      '.audit-tools/**',
      '.audit-output/**',
    ],
  },
]

export default eslintConfig
