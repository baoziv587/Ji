优先复用 已有的ui components https://mygo.egoist.dev/docs/ui/
Styling and themes https://mygo.egoist.dev/docs/ui/styling
Animation https://mygo.egoist.dev/docs/ui/drawing
代码本身逻辑不复杂、通过代码即可理解时，不写注释。仅在需要解释复杂逻辑、设计原因或非显而易见的约束时添加注释。
Glass blur: https://mygo.egoist.dev/docs/plugins/glass#styles
性能：mygo 每帧都会重建整个视图，所以每帧的工作量不能随会话变长而增加。写视图、改会话区之前，先读 [docs/mygo-performance.md](docs/mygo-performance.md)。
