"""
NeuMathe 终极精准爬虫 v3.0
============================
核心策略：
1. 先通过 /question/chapters 接口获取完整的章节目录树（只需 1 次请求）
2. 递归遍历树结构，提取所有"叶子节点"的 ID（只有叶子节点才挂载题目）
3. 仅对这些精确的叶子 ID 发起抓取请求 → 0% 废请求率 → 彻底杜绝封号

底层武装：
- curl_cffi 伪造 Chrome110 的 TLS/JA3 指纹
- 3.5~7.8 秒拟人化随机延时
- 自动断点续传（跳过已存在的本地文件）
"""

from curl_cffi import requests
import time
import json
import random
import os

def get_chapter_tree(headers):
    """第一步：获取完整章节目录树（上帝视角）"""
    print("[*] 正在获取完整章节目录树...")
    url = "https://api.neumathe.cn/question/chapters"
    params = {"subjectId": "3"}
    
    response = requests.get(url, headers=headers, params=params, impersonate="chrome110")
    
    if response.status_code == 200:
        data = response.json()
        # 保存原始目录树到本地，方便随时查阅
        with open("neumathe_chapter_tree.json", "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
        print("[+] 目录树获取成功！已保存到 neumathe_chapter_tree.json")
        return data
    else:
        print(f"[-] 获取目录树失败，HTTP {response.status_code}")
        print(f"[-] 响应内容: {response.text[:500]}")
        return None

def extract_leaf_ids_from_flat_list(data):
    """
    从扁平列表中提取叶子节点 ID。
    数据结构：每个节点有 id 和 parent_id，通过 parent_id 构建父子关系。
    叶子节点 = 没有任何其他节点以它为 parent_id 的节点。
    """
    items = data.get("data", {}).get("data", [])
    if not items:
        # 兼容其他可能的数据结构
        items = data.get("data", [])
    
    print(f"[*] 目录树中共有 {len(items)} 个节点")
    
    # 收集所有被当作 parent 的 ID
    all_ids = set()
    parent_ids_set = set()
    
    for item in items:
        all_ids.add(item["id"])
        if "parent_id" in item and item["parent_id"]:
            parent_ids_set.add(item["parent_id"])
    
    # 叶子节点 = 存在于 all_ids 中，但不在 parent_ids_set 中的节点
    leaf_nodes = []
    parent_nodes = []
    
    for item in items:
        node_id = item["id"]
        node_name = item.get("chapter_name", "")
        count = item.get("count", 0)
        
        if node_id in parent_ids_set:
            parent_nodes.append({"id": node_id, "name": node_name, "count": count})
        else:
            leaf_nodes.append({"id": node_id, "name": node_name, "count": count})
    
    print(f"\n[*] 目录树分析完成:")
    print(f"    父节点（文件夹）: {len(parent_nodes)} 个")
    print(f"    叶子节点（末端）: {len(leaf_nodes)} 个")
    
    # 只保留 count > 0 的叶子（有题目的）
    valid_leaves = [n for n in leaf_nodes if n["count"] > 0]
    empty_leaves = [n for n in leaf_nodes if n["count"] == 0]
    
    print(f"    有题目的叶子: {len(valid_leaves)} 个")
    if empty_leaves:
        print(f"    空叶子（无题目）: {len(empty_leaves)} 个 → 将自动跳过")
        for n in empty_leaves:
            print(f"        [跳过] ID={n['id']} {n['name']}")
    
    print(f"\n[*] 精确目标 ID 列表 ({len(valid_leaves)} 个):")
    for n in valid_leaves:
        print(f"    ID={n['id']:>4d}  ({n['count']:>3d}题)  {n['name']}")
    
    return valid_leaves  # 返回完整节点（含 id, name, count）

def scrape_with_precision(headers, leaf_nodes):
    """
    第二步：精确打击 - 绝对零废请求版本
    利用目录树的 count 字段提前计算精确页数，
    不再发送任何"探测下一页是否为空"的多余请求。
    """
    import math
    PAGE_SIZE = 10
    
    print(f"\n[*] 精确目标锁定完毕，共 {len(leaf_nodes)} 个叶子节点待抓取")
    
    for idx, node in enumerate(leaf_nodes):
        chapter_id = node["id"]
        count = node["count"]
        total_pages = math.ceil(count / PAGE_SIZE)  # 精确页数，无需探测
        
        # 断点续传：如果文件已存在就跳过
        output_filename = f"neumathe_chapter_{chapter_id}_raw.json"
        if os.path.exists(output_filename):
            print(f"[~] 章节 {chapter_id} 已存在，跳过。({idx+1}/{len(leaf_nodes)})")
            continue
        
        all_data = []
        print(f"[*] [{idx+1}/{len(leaf_nodes)}] Chapter {chapter_id}: {count}题/{total_pages}页")
        
        success = True
        for page in range(1, total_pages + 1):
            params = {
                "subject_id": 3,
                "chapter_id": chapter_id,
                "page": page,
                "page_size": PAGE_SIZE,
                "star": "false"
            }
            
            try:
                response = requests.get(
                    "https://api.neumathe.cn/question/list",
                    headers=headers, params=params, impersonate="chrome110"
                )
                
                if response.status_code == 200:
                    json_payload = response.json()
                    questions = json_payload.get("data", {}).get("questions", [])
                    
                    # 移除评论区
                    for q in questions:
                        if "comments" in q:
                            del q["comments"]
                    
                    all_data.append(json_payload)
                    print(f"    [+] {page}/{total_pages}: {len(questions)} 题")
                    
                elif response.status_code in [401, 403]:
                    print(f"[-] 致命错误 (HTTP {response.status_code}): Token 失效或账号被封。")
                    return
                else:
                    print(f"[-] 异常 HTTP {response.status_code}")
                    success = False
                    break
                    
            except Exception as e:
                print(f"[!] 异常: {e}")
                success = False
                break
            
            # 只在还有下一页时才延时（最后一页之后不延时，直接保存）
            if page < total_pages:
                time.sleep(random.uniform(5.0, 12.0))
        
        if all_data and success:
            with open(output_filename, "w", encoding="utf-8") as f:
                json.dump(all_data, f, ensure_ascii=False, indent=4)
            print(f"    [OK] 已保存 -> {output_filename}")
        
        # 章节之间的随机间隔（加大到 8-15 秒）
        time.sleep(random.uniform(8.0, 15.0))
    
    print("\n[*] ========== 全部任务执行完毕！ ==========")

def main():
    headers = {
        "accept": "application/json, text/plain, */*",
        "origin": "https://neumathe.cn",
        "referer": "https://neumathe.cn/",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
        "x-auth-token": "0fe5bf49-87e4-41d0-a4ad-e279fd15b778",
        "x-show-comments-default": "true",
        "x-show-question-progress": "true"
    }
    
    # ======== 阶段 1：获取目录树 ========
    tree_data = get_chapter_tree(headers)
    if not tree_data:
        print("[-] 无法获取目录树，终止。")
        return
    
    # ======== 阶段 2：分析目录结构，提取精确叶子节点（含 count） ========
    leaf_nodes = extract_leaf_ids_from_flat_list(tree_data)
    
    # 保存叶子 ID 列表
    leaf_ids = [n["id"] for n in leaf_nodes]
    with open("neumathe_leaf_ids.json", "w", encoding="utf-8") as f:
        json.dump({"leaf_ids": leaf_ids, "total": len(leaf_ids)}, f, ensure_ascii=False, indent=2)
    print(f"\n    已保存精确 ID 列表 -> neumathe_leaf_ids.json")
    
    # ======== 阶段 3：精确抓取（传入完整节点含 count） ========
    if leaf_nodes:
        input(f"\n[?] 即将开始精确抓取 {len(leaf_nodes)} 个叶子节点，按回车继续...")
        scrape_with_precision(headers, leaf_nodes)
    else:
        print("[-] 未能提取到叶子节点 ID，请检查目录树结构。")
        print("[*] 请打开 neumathe_chapter_tree.json 查看原始结构。")

if __name__ == "__main__":
    main()