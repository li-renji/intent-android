#!/bin/sh
# 璧风偣OS mini - 灞€鍩熺綉HTTP API鏈嶅姟
# 绔彛: 9999
# 璺敱:
#   GET  /health  鈫?鍋ュ悍妫€鏌?#   POST /chat    鈫?body鏄敤鎴穚rompt锛岃繑鍥濧I鍥炲

PORT=9999
REQ_FILE=/tmp/api_request
RESP_FILE=/tmp/api_response
RESP_PID_FILE=/tmp/api_resp_pid

echo "[http-api] 鍚姩锛岀洃鍚?0.0.0.0:$PORT"

while true; do
    # 绛夊緟涓€涓繛鎺?    DATA=$(echo -e "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\n\r\nok" | nc -l -p $PORT -w 3 2>/dev/null)
    
    if [ -z "$DATA" ]; then
        sleep 1
        continue
    fi
    
    # 瑙ｆ瀽璇锋眰琛?    REQUEST_LINE=$(echo "$DATA" | head -1)
    METHOD=$(echo "$REQUEST_LINE" | awk '{print $1}')
    PATH=$(echo "$REQUEST_LINE" | awk '{print $2}')
    
    echo "[http-api] $METHOD $PATH"
    
    # 鍋ュ悍妫€鏌?    if [ "$PATH" = "/health" ]; then
        BODY='{"status":"ok","service":"qidian-os-mini","port":9999}'
        LEN=$(echo -n "$BODY" | wc -c)
        echo -e "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: $LEN\r\nAccess-Control-Allow-Origin: *\r\n\r\n$BODY" | nc -l -p $PORT -w 1 2>/dev/null
        continue
    fi
    
    # 鑱婂ぉ鎺ュ彛
    if [ "$PATH" = "/chat" ] && [ "$METHOD" = "POST" ]; then
        # 鎻愬彇body锛堢┖琛屼箣鍚庣殑鍐呭锛?        BODY=$(echo "$DATA" | sed '1,/^$/d')
        
        # 鎶妏rompt鍐欏叆璇锋眰鏂囦欢
        echo "$BODY" > "$REQ_FILE"
        rm -f "$RESP_FILE"
        
        # 绛夊緟鍝嶅簲锛堟渶澶?0绉掞級
        WAITED=0
        while [ ! -f "$RESP_FILE" ] && [ $WAITED -lt 60 ]; do
            sleep 0.5
            WAITED=$((WAITED + 1))
        done
        
        if [ -f "$RESP_FILE" ]; then
            RESP=$(cat "$RESP_FILE")
            rm -f "$RESP_FILE"
        else
            RESP='{"error":"timeout"}'
        fi
        
        LEN=$(echo -n "$RESP" | wc -c)
        echo -e "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: $LEN\r\nAccess-Control-Allow-Origin: *\r\n\r\n$RESP" | nc -l -p $PORT -w 1 2>/dev/null
        continue
    fi
    
    # 404
    BODY='{"error":"not found"}'
    LEN=$(echo -n "$BODY" | wc -c)
    echo -e "HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nContent-Length: $LEN\r\n\r\n$BODY" | nc -l -p $PORT -w 1 2>/dev/null
done

