import re, sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

with open('NeuMathe_files/index-ChG32jDA.js.download', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. 搜索所有像 API 路径的字符串 (如 "/question/list", "/chapter/tree" 等)
found = set()
for m in re.finditer(r'"(/[a-z][a-z0-9_/-]{3,80})"', content):
    path = m.group(1)
    # 过滤掉明显是前端路由而非 API 的路径
    if not any(x in path for x in ['.css', '.js', '.svg', '.png', 'node_modules', 'LICENSE']):
        found.add(path)

print("=== 所有 API 风格路径 ===")
for path in sorted(found):
    print(path)

# 2. 搜索所有包含 neumathe 或 api 的完整 URL
print("\n=== 完整 URL ===")
for m in re.finditer(r'"(https?://[^"]{5,200})"', content):
    url = m.group(1)
    if 'neumathe' in url or 'api' in url:
        print(url)

# 3. 搜索 baseURL 相关配置
print("\n=== baseURL / baseUrl 配置 ===")
for m in re.finditer(r'.{0,100}base[Uu]rl.{0,100}', content, re.IGNORECASE):
    print(m.group())
    print("---")

# 4. 搜索 axios / fetch 调用模式
print("\n=== axios/fetch 创建实例 ===")
for m in re.finditer(r'.{0,120}(axios\.create|axios\.get|axios\.post|fetch\().{0,120}', content):
    print(m.group())
    print("---")

# 5. 搜索 subject_id 或 subject 相关
print("\n=== subject 相关 ===")
for m in re.finditer(r'.{0,80}subject.{0,80}', content, re.IGNORECASE):
    txt = m.group()
    if 'subject' in txt.lower() and len(txt) > 30:
        print(txt[:200])
        print("---")
