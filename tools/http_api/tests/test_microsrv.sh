#!/bin/sh
TB=/data/user/0/com.qidian.minios/files/rootfs/tmp/toybox

echo "=== Test / ==="
echo -e "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n" | $TB nc -w 2 127.0.0.1 8822
echo "---"

echo "=== Test /health ==="
echo -e "GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n" | $TB nc -w 2 127.0.0.1 8822
echo "---"

echo "=== Test /api ==="
echo -e "GET /api HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n" | $TB nc -w 2 127.0.0.1 8822