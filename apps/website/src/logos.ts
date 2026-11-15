export const logos = [
  { id: 'indigo', name: '靛蓝米白' },
  { id: 'cinnabar', name: '朱砂米白' },
  { id: 'pine', name: '松绿灰白' },
  { id: 'plum', name: '烟紫淡粉' },
  { id: 'charcoal', name: '暖黑燕麦' },
] as const

export const qinglv = {
  id: 'qinglv',
  name: '青绿江山',
  stops: [
    { offset: '0%', color: '#245a81' },
    { offset: '34%', color: '#207c88' },
    { offset: '68%', color: '#348e77' },
    { offset: '100%', color: '#79a46a' },
  ],
} as const

/** Paper-white rubbing for ink backgrounds: indigo paths, flat paper fill. */
export const paper = {
  id: 'paper',
  name: '纸白拓片',
  fill: '#ece5d9',
} as const
