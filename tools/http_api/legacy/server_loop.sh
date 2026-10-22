#!/bin/sh
TB=/data/user/0/com.qidian.minios/files/rootfs/tmp/toybox
BASE=/data/user/0/com.qidian.minios/files/rootfs/tmp
PORT=9999

while true; do
  # 启动nc -l，从response.fifo读响应，把请求写到request.log
  $TB nc -l -p $PORT < $BASE/response.fifo > $BASE/request.log 2>/dev/null &
  NC_PID=$!
  
  # 等请求文件有内容
  while [ ! -s $BASE/request.log ]; do
    sleep 0.1
    if ! kill -0 $NC_PID 2>/dev/null; then break; fi
  done
  
  if [ ! -s $BASE/request.log ]; then
    sleep 0.5
    continue
  fi
  
  # 读取请求
  REQUEST=$(cat $BASE/request.log)
  REQ_LINE=$(echo "$REQUEST" | head -1)
  URL=$(echo "$REQ_LINE" | awk '{print $2}')
  echo "[$(date)] $URL" >> $BASE/server.log
  
  # 生成响应
  if [ "$URL" = "/health" ]; then
    BODY='{"status":"ok","service":"qidian-os-mini"}'
  else
    BODY='{"error":"not found"}'
  fi
  
  # 写入响应FIFO
  $TB printf "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s" $(echo -n "$BODY" | $TB wc -c) "$BODY" > $BASE/response.fifo
  
  # 等nc结束
  wait $NC_PID 2>/dev/null
done