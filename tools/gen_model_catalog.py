#!/usr/bin/env python3
"""
生成模型商店的完整清单（含每个模型的文件列表、大小、sha256）。

用法:
    python tools/gen_model_catalog.py            # 更新 assets/model_catalog.json
    python tools/gen_model_catalog.py --check    # 只校验，不写文件

原理:
    ModelScope 官方 MNN 组织下的模型是 git-lfs 托管的大文件，
    逐个下载 868MB 来算 sha256 成本太高。这里用 ModelScope 的
    文件列表 API 拿准确大小，再对每个文件发一次 HEAD/Range 请求，
    从响应头里的 ETag（ModelScope 用 sha256 做 LFS oid）取校验值。

    拿不到 ETag 时退化为空 sha256 —— App 会跳过校验（仍校验文件大小）。
"""
import argparse
import hashlib
import json
import os
import sys
import urllib.request

MS_MODEL = "https://www.modelscope.cn"
MS_API = MS_MODEL + "/api/v1/models/{repo}/repo/files?Revision=master&Root="
MS_FILE = MS_MODEL + "/models/{repo}/resolve/master/{name}"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CATALOG = os.path.join(ROOT, "app", "src", "main", "assets", "model_catalog.json")


def http(url, timeout=30, headers=None, method="GET"):
    req = urllib.request.Request(url, headers=headers or {}, method=method)
    req.add_header("User-Agent", "QidianMiniOS-catalog-gen/1.0")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, dict(r.headers), r.read()


def sha256_of(url, size=0):
    """取文件的 sha256。

    ModelScope 的文件存在阿里 OSS 上，响应头里有两种可用校验值：
      X-Linked-ETag      → OSS 的 sha256（64位hex），优先用这个
      x-oss-hash-crc64ecma → CRC64，作为后备
    普通 ETag 是分片 etag（形如 xxx-43），不能当作 sha256。

    小文件（< 8MB）直接下载下来算 sha256 —— 响应头拿不到时更可靠。
    """
    # 小文件直接下载算哈希
    if 0 < size <= 8 * 1024 * 1024:
        try:
            _, _, body = http(url, timeout=120)
            return hashlib.sha256(body).hexdigest()
        except Exception:
            pass
    try:
        st, hdr, _ = http(url, headers={"Range": "bytes=0-0"}, method="GET")
        linked = (hdr.get("X-Linked-ETag") or hdr.get("x-linked-etag") or "").strip('"')
        if len(linked) == 64 and all(c in "0123456789abcdefABCDEF" for c in linked):
            return linked.lower()
        etag = (hdr.get("ETag") or "").strip('"')
        if len(etag) == 64 and all(c in "0123456789abcdefABCDEF" for c in etag):
            return etag.lower()
        return ""
    except Exception:
        return ""


def probe(repo):
    """返回 (files, total_bytes)"""
    _, _, raw = http(MS_API.format(repo=repo))
    data = json.loads(raw)
    entries = data.get("Data", {}).get("Files", [])
    files, total = [], 0
    for e in entries:
        name = e.get("Name")
        size = e.get("Size") or 0
        if not name or name.startswith("."):
            continue
        if name.lower() in ("readme.md", "configuration.json"):
            continue
        # embeddings_bf16.bin 是 llmexport 导出的原始 embedding 备份，
        # MNN LLM 推理只读 llm.mnn.weight，不需要它。
        # 排除后单个模型最多省 1.2GB 下载量。
        if name.lower() in ("embeddings_bf16.bin",):
            print("    (跳过 %s，推理不需要)" % name)
            continue
        files.append({"path": name, "bytes": size, "sha256": ""})
        total += size
    return files, total


def enrich(repo, files, with_sha):
    if not with_sha:
        return
    for f in files:
        url = MS_FILE.format(repo=repo, name=f["path"])
        s = sha256_of(url, f["bytes"])
        if s:
            f["sha256"] = s
        print("    %-22s %10d  %s" % (f["path"], f["bytes"], f["sha256"][:16] or "-"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只校验不写")
    ap.add_argument("--no-sha", action="store_true", help="跳过 sha256 抓取（快）")
    ap.add_argument("--only", default="", help="只处理某个 model id")
    args = ap.parse_args()

    with open(CATALOG, encoding="utf-8") as f:
        cat = json.load(f)

    changed = False
    for m in cat["models"]:
        if args.only and m["id"] != args.only:
            continue
        repo = m["repo"]
        print("[%s] %s" % (m["id"], repo))
        try:
            files, total = probe(repo)
        except Exception as e:
            print("  !! 拉取失败: %s" % e)
            continue
        enrich(repo, files, not args.no_sha)
        m["files"] = files
        m["total_bytes"] = total
        m["mirrors"] = [MS_FILE.format(repo=repo, name="")]  # 占位，实际按 path 拼接
        m["mirrors"] = [MS_MODEL + "/models/" + repo + "/resolve/master"]
        changed = True

    if not changed:
        print("没有变化")
        return 0
    if args.check:
        print("check 模式，未写入")
        return 0

    with open(CATALOG, "w", encoding="utf-8") as f:
        json.dump(cat, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("\n已写入 %s" % CATALOG)
    return 0


if __name__ == "__main__":
    sys.exit(main())
