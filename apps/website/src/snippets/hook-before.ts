import { before, definePlugin } from '@ji.dev/llm'

const lowTemperature = definePlugin({
  name: 'low-temperature',
  request: before(req => ({ ...req, options: { ...req.options, temperature: 0 } })),
})
