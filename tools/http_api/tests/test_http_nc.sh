#!/bin/sh
TB=/data/user/0/com.qidian.minios/files/rootfs/tmp/toybox
BASE=/data/user/0/com.qidian.minios/files/rootfs/tmp

# 先杀掉旧进程
pkill -f toybox 2>/dev/null
sleep 1

# 启动nc -l，stdin是固定响应，stdout是请求
echo "HTTP/1.1 200 OK" > $BASE/test_resp.txt
echo "Content-Type: application/json" >> $BASE/test_resp.txt
echo "" >> $BASE/test_resp.txt
echo '{"status":"ok"}' >> $BASE/test_resp.txt

$TB nc -l -p 9999 < $BASE/test_resp.txt > $BASE/test_req.txt &
echo "nc started, pid=$!"
sleep 2

echo "=== Port? ==="
netstat -tln | grep 9999