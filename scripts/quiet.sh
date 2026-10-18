#!/bin/sh
# 运行一条命令：成功时不出声，失败时才打印它的全部输出
out=$("$@" 2>&1) && exit 0
code=$?
printf '%s\n' "$out"
exit $code
