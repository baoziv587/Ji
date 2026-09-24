import antfu from '@antfu/eslint-config'
import { createSlopConfig } from 'eslint-plugin-slop'

export default antfu(
  { type: 'lib', typescript: true },
  ...createSlopConfig({
    cwd: import.meta.dirname,
    rules: {
      // 注释是中文，「——」是标准破折号
      'slop/no-em-dash': 'off',
    },
  }),
  {
    // demo 是 CLI，直接打印到终端
    files: ['apps/demo/**', 'apps/examples/**', 'packages/**'],
    rules: { 'no-console': 'off' },
  },
)
