优先复用 已有的ui components https://mygo.egoist.dev/docs/ui/
Styling and themes https://mygo.egoist.dev/docs/ui/styling
Animation https://mygo.egoist.dev/docs/ui/drawing
代码本身逻辑不复杂、通过代码即可理解时，不写注释。仅在需要解释复杂逻辑、设计原因或非显而易见的约束时添加注释。
Glass blur: https://mygo.egoist.dev/docs/plugins/glass#styles
性能：mygo 每帧都会重建整个视图，所以每帧的工作量不能随会话变长而增加。写视图、改会话区之前，先读 [docs/mygo-performance.md](docs/mygo-performance.md)。
颜色：不允许高饱和度。[ui/components/schemes.go](ui/components/schemes.go) 里每个颜色的 OKLCH chroma：大面积底色（Background、Card、Popover、Secondary、Muted、Accent、Sidebar、SidebarAccent、Border、Input、SidebarBorder）≤ 0.04，焦点环 Ring ≤ 0.06，其它（主色、文字、状态色）≤ 0.10，由 `TestSchemesAreUnsaturated` 检查。饱和度低，层次就靠亮度拉开：深色下 Card、Secondary、Border、Input 的 OKLCH 亮度要比 Background 依次高出至少 0.05、0.09、0.13、0.17，MutedForeground ≥ 0.72 且比 Foreground 低 0.12 以上，由 `TestDarkSchemesStepApart` 检查。不允许出现紫色（OKLCH 色相 280°–345°），Thinking 用该方案主色的色相、chroma 约 0.045，由 `TestSchemesHaveNoViolet` 检查。视图里不要直接写 Hex 颜色，一律用调色板；焦点光圈用 `p.Ring.Alpha(0.25)`，不要更浓。
