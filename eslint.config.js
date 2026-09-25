import antfu from '@antfu/eslint-config'
import { createSlopConfig } from 'eslint-plugin-slop'

export default antfu(
  {
    type: 'lib',
    typescript: true,
    // 格式化交给 oxfmt，ESLint 只管代码质量
    stylistic: false,
  },
  ...createSlopConfig({
    cwd: import.meta.dirname,
  }),
  {
    // demo 是 CLI，直接打印到终端
    files: ['apps/demo/**', 'apps/examples/**', 'packages/**'],
    rules: { 'no-console': 'off' },
  },
  {
    // demo 和示例是直接用 node 运行的脚本，入口处用顶层 await
    files: ['apps/demo/src/**', 'apps/examples/src/**'],
    rules: { 'antfu/no-top-level-await': 'off' },
  },
)
