import tarfile

t = tarfile.open('app/src/main/assets/rootfs.tar', 'r')

print('=== 用户/ 目录内容 ===')
for m in sorted(t.getmembers(), key=lambda x: x.name):
    if m.name.startswith('用户') or m.name.startswith('./用户'):
        suffix = '/' if m.isdir() else ' ({}b)'.format(m.size)
        print(m.name + suffix)

print()
print('=== .git 仓库状态 ===')
git_files = {}
for m in t.getmembers():
    if '/.git/' in m.name and m.isfile():
        parts = m.name.split('/.git/')
        module_path = parts[0]
        git_path = parts[1]
        if module_path not in git_files:
            git_files[module_path] = []
        git_files[module_path].append(git_path)

for module in sorted(git_files.keys()):
    files = git_files[module]
    has_objects = any(f.startswith('objects/') and len(f) > len('objects/') for f in files)
    has_head = 'HEAD' in files
    head_content = ''
    for m in t.getmembers():
        if m.name == module + '/.git/HEAD':
            f = t.extractfile(m)
            if f:
                head_content = f.read().decode('utf-8', errors='replace').strip()
            break
    print('{}:'.format(module))
    print('  HEAD: {}'.format(head_content if head_content else '(missing)'))
    print('  有commit对象: {}'.format('是' if has_objects else '否（仅git init，无提交记录）'))
    print()

print('=== 规范对照检查 ===')
required = {
    '系统/兼容.qd': ['安卓.qd', 'Win32.qd', '安装管理.qds', '闪退保护.qds', 'compat_ai.qdai'],
    '系统/功能.qd': ['进程调度.qds', 'shm_ipc.qds', 'func_ai.qdai'],
    '系统/界面.qd': ['窗口管理.qds', '渲染管线.qds', 'ui_ai.qdai'],
    '系统/微服务.qd': ['microsrv.qds', 'microsrv.qdai'],
    'AI.qd': ['ai_service.qds'],
}

all_names = [m.name for m in t.getmembers()]

for module, items in required.items():
    print('{}:'.format(module))
    for item in items:
        full = module + '/' + item
        found = any(n == full or n.startswith(full + '/') for n in all_names)
        status = 'OK' if found else 'MISSING'
        print('  [{}] {}'.format(status, item))
    print()
