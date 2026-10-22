#!/bin/sh
BASE=/data/user/0/com.qidian.minios/files/rootfs/tmp
TOYBOX=$BASE/toybox
PORT=9999
REQ_FILE=$BASE/http_request.txt
RESP_FIFO=$BASE/http_response_fifo

echo "[http-api] starting on port $PORT"

rm -f $RESP_FIFO
mkfifo $RESP_FIFO

while true; do
  rm -f $REQ_FILE
  $TOYBOX nc -l -p $PORT < $RESP_FIFO > $REQ_FILE 2>/dev/null &
  NC_PID=$!
  while [ ! -s $REQ_FILE ]; do
    sleep 0.1
    if ! kill -0 $NC_PID 2>/dev/null; then break; fi
  done
  if [ ! -s $REQ_FILE ]; then sleep 0.5; continue; fi
  REQUEST=$(cat $REQ_FILE)
  REQ_LINE=$(echo "$REQUEST" | head -1)
  METHOD=$(echo "$REQ_LINE" | awk '{print $1}')
  PATH=$(echo "$REQ_LINE" | awk '{print $2}')
  echo "[http-api] $METHOD $PATH"
  if [ "$PATH" = "/health" ]; then
    BODY='{"status":"ok","service":"qidian-os-mini"}'
  elif [ "$PATH" = "/chat" ] && [ "$METHOD" = "POST" ]; then
    BODY=$(echo "$REQUEST" | sed '1,/^$/d')
    echo "$BODY" > $BASE/api_request
    rm -f $BASE/api_response
    i=0
    while [ ! -f $BASE/api_response ] && [ $i -lt 120 ]; do
      sleep 0.5
      i=$((i+1))
    done
    if [ -f $BASE/api_response ]; then
      BODY=$(cat $BASE/api_response)
      rm -f $BASE/api_response
    else
      BODY='{"error":"timeout"}'
    fi
  else
    BODY='{"error":"not found"}'
  fi
  LEN=$(echo -n "$BODY" | wc -c)
  printf "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %s\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n%s" "$LEN" "$BODY" > $RESP_FIFO
  wait $NC_PID 2>/dev/null
  echo "[http-api] done $PATH"
done