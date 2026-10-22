#!/bin/sh
TB=/data/user/0/com.qidian.minios/files/rootfs/tmp/toybox
BASE=/data/user/0/com.qidian.minios/files/rootfs/tmp
PORT=9999

echo "[server] starting on port $PORT"

rm -f $BASE/resp.fifo
mkfifo $BASE/resp.fifo
sleep 10000 > $BASE/resp.fifo &
echo "[server] fifo ready"

while true; do
  rm -f $BASE/request.log
  
  $TB nc -l -p $PORT < $BASE/resp.fifo > $BASE/request.log 2>/dev/null &
  NC_PID=$!
  
  while [ ! -s $BASE/request.log ]; do
    sleep 0.1
    if ! kill -0 $NC_PID 2>/dev/null; then break; fi
  done
  
  if [ ! -s $BASE/request.log ]; then
    sleep 0.5
    continue
  fi
  
  REQUEST=$(cat $BASE/request.log)
  REQ_LINE=$(echo "$REQUEST" | head -1)
  METHOD=$(echo "$REQ_LINE" | awk '{print $1}')
  URL=$(echo "$REQ_LINE" | awk '{print $2}')
  echo "[server] $METHOD $URL"
  
  if [ "$URL" = "/health" ]; then
    BODY='{"status":"ok","service":"qidian-os-mini","model":"qwen2.5-1.5b"}'
  elif [ "$URL" = "/chat" ] && [ "$METHOD" = "POST" ]; then
    # 提取请求body
    BODY=$(echo "$REQUEST" | sed '1,/^$/d')
    echo "prompt: $BODY"
    
    # 写入AI请求文件
    echo "$BODY" > $BASE/api_request
    rm -f $BASE/api_response
    
    # 等AI回复（最多60秒）
    i=0
    while [ ! -f $BASE/api_response ] && [ $i -lt 120 ]; do
      sleep 0.5
      i=$((i+1))
    done
    
    if [ -f $BASE/api_response ]; then
      BODY=$(cat $BASE/api_response)
      rm -f $BASE/api_response
    else
      BODY='{"error":"AI timeout"}'
    fi
  else
    BODY='{"error":"not found"}'
  fi
  
  LEN=$(echo -n "$BODY" | $TB wc -c)
  
  $TB printf "HTTP/1.1 200 OK\r\n" > $BASE/resp.fifo
  $TB printf "Content-Type: application/json\r\n" >> $BASE/resp.fifo
  $TB printf "Access-Control-Allow-Origin: *\r\n" >> $BASE/resp.fifo
  $TB printf "Content-Length: %d\r\n" $LEN >> $BASE/resp.fifo
  $TB printf "\r\n" >> $BASE/resp.fifo
  $TB printf "%s" "$BODY" >> $BASE/resp.fifo
  
  wait $NC_PID 2>/dev/null
  echo "[server] done $URL"
done