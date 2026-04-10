import os
import json

def scan_missing_analysis():
    raw_dir = 'data/raw'
    report = []
    
    if not os.path.exists(raw_dir):
        print(f"Error: Directory {raw_dir} not found.")
        return

    files = [f for f in os.listdir(raw_dir) if f.startswith('neumathe_chapter_') and f.endswith('_raw.json')]
    
    for filename in sorted(files):
        chapter_id = filename.split('_')[2]
        filepath = os.path.join(raw_dir, filename)
        
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
                
            # Handle potential nested structure
            questions = []
            if isinstance(data, list) and len(data) > 0:
                # Structure: [ {"data": {"questions": [...]}}, ... ]
                for page in data:
                    if isinstance(page, dict) and 'data' in page and 'questions' in page['data']:
                        questions.extend(page['data']['questions'])
                    elif isinstance(page, dict) and 'questions' in page:
                        questions.extend(page['questions'])
            elif isinstance(data, dict):
                # Structure: {"data": {"questions": [...]}} or similar
                if 'data' in data and 'questions' in data['data']:
                    questions = data['data']['questions']
                elif 'questions' in data:
                    questions = data['questions']
            
            for idx, q in enumerate(questions):
                analysis = q.get('analysis', '')
                analysis_image = q.get('analysis_image', '')
                
                # Missing if both text and image are empty or placeholder
                is_missing = not analysis or analysis.strip() == '暂无解析' or analysis.strip() == ''
                has_image = bool(analysis_image)
                
                if is_missing and not has_image:
                    report.append({
                        "chapter_id": chapter_id,
                        "question_index": idx + 1,
                        "question_id": q.get('question_id', 'unknown'),
                        "question_text_preview": q.get('question', '')[:50] + '...'
                    })
        except Exception as e:
            print(f"Error reading {filename}: {e}")

    with open('reports/missing_analysis_report.json', 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    
    print(f"Scan complete. Found {len(report)} questions missing analysis.")
    print("Report saved to reports/missing_analysis_report.json")

if __name__ == "__main__":
    scan_missing_analysis()
