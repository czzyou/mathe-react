from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image, ImageDraw


PADDLEOCR = Path(r"E:\something_projects\railpdf\.paddleocr-venv\Scripts\paddleocr.exe")
PUBLIC_DIR = Path("mathreact/public")
CHAPTER_DIR = PUBLIC_DIR / "data" / "chapters"
WORK_DIR = Path("reports/pdf_ocr_text_work")
CROP_DIR = WORK_DIR / "crops"
MASKED_DIR = WORK_DIR / "masked"
FORMULA_DIR = WORK_DIR / "formula"
OCR_DIR = WORK_DIR / "ocr"

SCALE = 2.5
X_LEFT = 34.0
X_RIGHT = 572.0
PAGE_TOP = 818.0
PAGE_BOTTOM = 42.0
CREATED_SECONDS = 1766137662

TARGETS = [
    (401, Path(r"D:\Downloads\1766137650_第七章"), "7.2.2.2 有效性和相合性.pdf", 13),
    (404, Path(r"D:\Downloads\1766137650_第七章"), "7.3.1.1 均值的区间估计.pdf", 23),
    (405, Path(r"D:\Downloads\1766137650_第七章"), "7.3.1.2 方差的区间估计.pdf", 8),
    (407, Path(r"D:\Downloads\1766137650_第七章"), "7.3.2.1 均值差的区间估计.pdf", 6),
    (408, Path(r"D:\Downloads\1766137650_第七章"), "7.3.2.2 方差比的区间估计.pdf", 4),
    (409, Path(r"D:\Downloads\1766137650_第七章"), "7.3.3 一般总体参数的区间估计.pdf", 11),
    (412, Path(r"D:\Downloads\1766137662_第八章 (1)"), "8.1.1 假设检验问题.pdf", 9),
    (413, Path(r"D:\Downloads\1766137662_第八章 (1)"), "8.1.2 假设检验中的两类错误.pdf", 15),
    (416, Path(r"D:\Downloads\1766137662_第八章 (1)"), "8.2.1.1 均值检验.pdf", 33),
    (417, Path(r"D:\Downloads\1766137662_第八章 (1)"), "8.2.1.2 方差检验.pdf", 20),
    (419, Path(r"D:\Downloads\1766137662_第八章 (1)"), "8.2.2.1 均值差检验.pdf", 27),
    (420, Path(r"D:\Downloads\1766137662_第八章 (1)"), "8.2.2.2 方差比检验.pdf", 11),
    (421, Path(r"D:\Downloads\1766137662_第八章 (1)"), "8.3 一般总体参数的假设检验.pdf", 17),
    (422, Path(r"D:\Downloads\1766137662_第八章 (1)"), "8.4 总体分布的假设检验.pdf", 12),
]

MANUAL_FIXES: dict[tuple[int, int], dict[str, object]] = {
    (401, 7): {
        "choices": {
            "A": r"$\widehat{m_3}$",
            "B": r"$\widehat{m_1}$",
            "C": r"$\widehat{m_2}$",
            "D": "一样大",
        }
    },
    (420, 1): {
        "choices": {
            "A": r"$\frac{S_1^2}{\lambda S_2^2}$",
            "B": r"$\frac{S_1^2}{S_2^2}$",
            "C": r"$\frac{\lambda S_1^2}{S_2^2}$",
            "D": r"$\frac{\lambda S_2^2}{S_1^2}$",
        }
    }
}


@dataclass(frozen=True)
class Start:
    number: int
    page_index: int
    text_index: int
    box: tuple[float, float, float, float]


@dataclass(frozen=True)
class Slice:
    chapter_id: int
    question_no: int
    page_index: int
    top: float
    bottom: float
    kind: str
    slice_index: int
    filename: str


@dataclass
class QuestionBuild:
    chapter_id: int
    question_no: int
    answer_label: str
    question_slices: list[str]
    analysis_slices: list[str]


def union_charbox(textpage, start: int, count: int) -> tuple[float, float, float, float] | None:
    boxes = []
    for index in range(start, start + count):
        char = textpage.get_text_range(index, 1)
        if char and char.strip():
            boxes.append(textpage.get_charbox(index))
    if not boxes:
        return None
    return (
        min(box[0] for box in boxes),
        min(box[1] for box in boxes),
        max(box[2] for box in boxes),
        max(box[3] for box in boxes),
    )


def find_question_starts(pdf, total: int) -> list[Start]:
    candidates: list[Start] = []
    for page_index in range(len(pdf)):
        textpage = pdf[page_index].get_textpage()
        text = textpage.get_text_range()
        for match in re.finditer(r"(?:^|\r\n)(\d{1,2})\.\r\n", text):
            number = int(match.group(1))
            if not 1 <= number <= total:
                continue
            text_index = match.start(1)
            box = union_charbox(textpage, text_index, len(match.group(1)) + 1)
            if box and box[0] <= 82 and box[2] <= 95:
                candidates.append(Start(number, page_index, text_index, box))

    starts: list[Start] = []
    expected = 1
    for candidate in sorted(candidates, key=lambda item: (item.page_index, item.text_index)):
        if candidate.number == expected:
            starts.append(candidate)
            expected += 1
        if expected > total:
            break

    if len(starts) != total:
        raise RuntimeError(f"Expected {total} starts, found {len(starts)}")
    return starts


def find_marker(pdf, start: Start, next_start: Start | None, marker: str) -> tuple[int, tuple[float, float, float, float]] | None:
    last_page = next_start.page_index if next_start else len(pdf) - 1
    for page_index in range(start.page_index, last_page + 1):
        textpage = pdf[page_index].get_textpage()
        text = textpage.get_text_range()
        begin = start.text_index if page_index == start.page_index else 0
        end = next_start.text_index if next_start and page_index == next_start.page_index else len(text)
        index = text.find(marker, begin, end)
        if index >= 0:
            box = union_charbox(textpage, index, len(marker))
            if box:
                return page_index, box
    return None


def extract_question_text(pdf, start: Start, next_start: Start | None) -> str:
    parts: list[str] = []
    last_page = next_start.page_index if next_start else len(pdf) - 1
    for page_index in range(start.page_index, last_page + 1):
        text = pdf[page_index].get_textpage().get_text_range()
        begin = start.text_index if page_index == start.page_index else 0
        end = next_start.text_index if next_start and page_index == next_start.page_index else len(text)
        parts.append(text[begin:end])
    return "\r\n".join(parts)


def parse_answer(question_text: str) -> str:
    match = re.search(r"(?:^|\r\n)\s*([A-D])(?:[^\r\n]*)【答案】", question_text)
    if match:
        return match.group(1)
    match = re.search(r"([A-D])\s*【答案】", question_text)
    if match:
        return match.group(1)
    raise RuntimeError("Could not parse answer")


def segment_top(start: Start, page_index: int) -> float:
    return min(PAGE_TOP, start.box[3] + 14.0) if start.page_index == page_index else PAGE_TOP


def segment_bottom(next_start: Start | None, page_index: int) -> float:
    return min(PAGE_TOP, next_start.box[3] + 12.0) if next_start and next_start.page_index == page_index else PAGE_BOTTOM


def build_slices(chapter_id: int, question_no: int, pdf, start: Start, next_start: Start | None) -> tuple[list[Slice], list[Slice]]:
    marker = find_marker(pdf, start, next_start, "【解析】")
    last_page = next_start.page_index if next_start else len(pdf) - 1
    question_slices: list[Slice] = []
    analysis_slices: list[Slice] = []

    def add(kind: str, page_index: int, top: float, bottom: float) -> None:
        if top - bottom <= 8:
            return
        collection = question_slices if kind == "question" else analysis_slices
        filename = f"ch{chapter_id}_q{question_no:03d}_{kind}_{len(collection) + 1}.png"
        collection.append(Slice(chapter_id, question_no, page_index, top, bottom, kind, len(collection) + 1, filename))

    if not marker:
        for page_index in range(start.page_index, last_page + 1):
            add("question", page_index, segment_top(start, page_index), segment_bottom(next_start, page_index))
        return question_slices, analysis_slices

    analysis_page, analysis_box = marker
    for page_index in range(start.page_index, last_page + 1):
        top = segment_top(start, page_index)
        bottom = segment_bottom(next_start, page_index)
        if page_index < analysis_page:
            add("question", page_index, top, bottom)
        elif page_index == analysis_page:
            analysis_top = min(PAGE_TOP, analysis_box[3] + 10.0)
            add("question", page_index, top, analysis_top)
            add("analysis", page_index, analysis_top, bottom)
        else:
            add("analysis", page_index, top, bottom)
    return question_slices, analysis_slices


def page_crop_box(page_width: float, page_height: float, top: float, bottom: float) -> tuple[int, int, int, int]:
    return (
        max(0, round(X_LEFT * SCALE)),
        max(0, round((page_height - top) * SCALE)),
        min(round(page_width * SCALE), round(X_RIGHT * SCALE)),
        min(round(page_height * SCALE), round((page_height - bottom) * SCALE)),
    )


def trim_bottom_whitespace(image: Image.Image) -> Image.Image:
    gray = image.convert("L")
    width, height = gray.size
    pixels = gray.load()
    last_dark_row = -1
    for y in range(height):
        for x in range(width):
            if pixels[x, y] < 220:
                last_dark_row = y
                break
    if last_dark_row < 0:
        return image
    bottom = min(height, last_dark_row + 34)
    if height - bottom < 60:
        return image
    return image.crop((0, 0, width, bottom))


def crop_slice(rendered_pages: dict[int, Image.Image], page_sizes: dict[int, tuple[float, float]], item: Slice) -> None:
    page_width, page_height = page_sizes[item.page_index]
    image = rendered_pages[item.page_index].crop(page_crop_box(page_width, page_height, item.top, item.bottom)).convert("RGB")
    image = trim_bottom_whitespace(image)
    image.save(CROP_DIR / item.filename, optimize=True)


def generate_crops() -> dict[tuple[int, int], QuestionBuild]:
    if WORK_DIR.exists():
        shutil.rmtree(WORK_DIR)
    CROP_DIR.mkdir(parents=True, exist_ok=True)
    CHAPTER_DIR.mkdir(parents=True, exist_ok=True)

    builds: dict[tuple[int, int], QuestionBuild] = {}
    manifest: list[dict] = []

    for chapter_id, pdf_dir, pdf_name, total in TARGETS:
        pdf_path = pdf_dir / pdf_name
        pdf = pdfium.PdfDocument(str(pdf_path))
        starts = find_question_starts(pdf, total)
        rendered_pages: dict[int, Image.Image] = {}
        page_sizes: dict[int, tuple[float, float]] = {}
        for page_index in range(len(pdf)):
            page = pdf[page_index]
            page_sizes[page_index] = page.get_size()
            rendered_pages[page_index] = page.render(scale=SCALE).to_pil().convert("RGB")

        for index, start in enumerate(starts):
            question_no = index + 1
            next_start = starts[index + 1] if index + 1 < len(starts) else None
            answer = parse_answer(extract_question_text(pdf, start, next_start))
            question_slices, analysis_slices = build_slices(chapter_id, question_no, pdf, start, next_start)
            for item in question_slices + analysis_slices:
                crop_slice(rendered_pages, page_sizes, item)
                manifest.append(item.__dict__)
            builds[(chapter_id, question_no)] = QuestionBuild(
                chapter_id=chapter_id,
                question_no=question_no,
                answer_label=answer,
                question_slices=[item.filename for item in question_slices],
                analysis_slices=[item.filename for item in analysis_slices],
            )

    (WORK_DIR / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (WORK_DIR / "builds.json").write_text(
        json.dumps({f"{cid}-{qno}": build.__dict__ for (cid, qno), build in builds.items()}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return builds


def run_paddle() -> None:
    FORMULA_DIR.mkdir(parents=True, exist_ok=True)
    MASKED_DIR.mkdir(parents=True, exist_ok=True)
    OCR_DIR.mkdir(parents=True, exist_ok=True)

    formula_log = WORK_DIR / "formula.log"
    ocr_log = WORK_DIR / "ocr.log"

    with formula_log.open("w", encoding="utf-8", errors="replace") as log:
        subprocess.run(
            [
                str(PADDLEOCR),
                "formula_recognition_pipeline",
                "-i",
                str(CROP_DIR),
                "--save_path",
                str(FORMULA_DIR),
                "--use_doc_orientation_classify",
                "False",
                "--use_doc_unwarping",
                "False",
            ],
            stdout=log,
            stderr=subprocess.STDOUT,
            check=True,
        )

    for crop_path in CROP_DIR.glob("*.png"):
        image = Image.open(crop_path).convert("RGB")
        draw = ImageDraw.Draw(image)
        formula_json = formula_json_path(crop_path.name)
        if formula_json.exists():
            data = json.loads(formula_json.read_text(encoding="utf-8"))
            for formula in data.get("formula_res_list", []):
                x1, y1, x2, y2 = formula["dt_polys"][0]
                draw.rectangle([x1 - 3, y1 - 3, x2 + 3, y2 + 3], fill="white")
        image.save(MASKED_DIR / crop_path.name, optimize=True)

    with ocr_log.open("w", encoding="utf-8", errors="replace") as log:
        subprocess.run(
            [
                str(PADDLEOCR),
                "ocr",
                "-i",
                str(MASKED_DIR),
                "--save_path",
                str(OCR_DIR),
                "--lang",
                "ch",
                "--ocr_version",
                "PP-OCRv5",
                "--use_doc_orientation_classify",
                "False",
                "--use_doc_unwarping",
                "False",
                "--use_textline_orientation",
                "False",
            ],
            stdout=log,
            stderr=subprocess.STDOUT,
            check=True,
        )


def formula_json_path(filename: str) -> Path:
    return FORMULA_DIR / f"{Path(filename).stem}_res.json"


def ocr_json_path(filename: str) -> Path:
    return OCR_DIR / f"{Path(filename).stem}_res.json"


def center(box: list[float]) -> tuple[float, float]:
    return (float(box[0] + box[2]) / 2, float(box[1] + box[3]) / 2)


def normalize_formula(latex: str) -> str:
    latex = latex.strip()
    latex = latex.replace(r"\,", ",")
    latex = latex.rstrip(",，")
    return latex


def formula_token(latex: str, display: bool = False) -> str:
    latex = normalize_formula(latex)
    if not latex:
        return ""
    return f"$${latex}$$" if display else f"${latex}$"


def clean_text_token(text: str) -> str:
    text = text.strip()
    text = text.replace("【答案】", "")
    text = text.replace("【解析】", "")
    text = text.replace("（", "(").replace("）", ")")
    text = text.replace("，", ",").replace("。", ".")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def postprocess_line(line: str) -> str:
    line = line.strip()
    line = re.sub(r"\bN[eo]u\w*\b", "", line, flags=re.IGNORECASE)
    line = re.sub(r"\b(?:athe|eul\w*)\b", "", line, flags=re.IGNORECASE)
    line = re.sub(r"\s+", " ", line)
    line = line.replace("$E(X)=\\mu$$", "$E(X)=\\mu$")
    line = re.sub(r"(?<=[下列为是和与且,，\s])u(?=的|,|，|\\s|$)", r"$\\mu$", line)
    line = re.sub(r"(?<=[为是和与且,，\s])o(?=\^?2|2|,|，|\s|$)", r"$\\sigma$", line)
    line = line.replace(" ,", ",").replace(" .", ".")
    line = line.replace("( ).", "( ).")
    return line.strip()


def is_noise_text(text: str) -> bool:
    compact = re.sub(r"\s+", "", text)
    if not compact:
        return True
    if "NeuMathe" in compact or "NouMath" in compact or "euMathe" in compact:
        return True
    if re.fullmatch(r"\d+/\d+·?NeuMathe", compact):
        return True
    return False


def merge_crop_text(filename: str) -> str:
    crop_path = CROP_DIR / filename
    width = Image.open(crop_path).width
    items: list[dict] = []

    formula_path = formula_json_path(filename)
    if formula_path.exists():
        data = json.loads(formula_path.read_text(encoding="utf-8"))
        for formula in data.get("formula_res_list", []):
            x1, y1, x2, y2 = [float(v) for v in formula["dt_polys"][0]]
            latex = normalize_formula(formula.get("rec_formula", ""))
            if not latex:
                continue
            items.append(
                {
                    "kind": "formula",
                    "text": latex,
                    "x1": x1,
                    "y1": y1,
                    "x2": x2,
                    "y2": y2,
                    "cx": (x1 + x2) / 2,
                    "cy": (y1 + y2) / 2,
                    "w": x2 - x1,
                }
            )

    ocr_path = ocr_json_path(filename)
    if ocr_path.exists():
        data = json.loads(ocr_path.read_text(encoding="utf-8"))
        for text, score, box in zip(data.get("rec_texts", []), data.get("rec_scores", []), data.get("rec_boxes", [])):
            cleaned = clean_text_token(text)
            if score < 0.45 or is_noise_text(cleaned):
                continue
            x1, y1, x2, y2 = [float(v) for v in box]
            items.append(
                {
                    "kind": "text",
                    "text": cleaned,
                    "x1": x1,
                    "y1": y1,
                    "x2": x2,
                    "y2": y2,
                    "cx": (x1 + x2) / 2,
                    "cy": (y1 + y2) / 2,
                    "w": x2 - x1,
                }
            )

    lines: list[dict] = []
    for item in sorted(items, key=lambda row: row["cy"]):
        threshold = max(18.0, min(28.0, (item["y2"] - item["y1"]) * 0.75))
        for line in lines:
            if abs(line["cy"] - item["cy"]) <= threshold:
                line["items"].append(item)
                line["cy"] = sum(i["cy"] for i in line["items"]) / len(line["items"])
                break
        else:
            lines.append({"cy": item["cy"], "items": [item]})

    rendered: list[str] = []
    for line in lines:
        parts = []
        line_items = sorted(line["items"], key=lambda row: row["x1"])
        only_formula = len(line_items) == 1 and line_items[0]["kind"] == "formula"
        for item in line_items:
            if item["kind"] == "formula":
                display = only_formula and item["w"] > width * 0.35
                token = formula_token(item["text"], display=display)
            else:
                token = item["text"]
            if token:
                parts.append(token)
        text = postprocess_line(" ".join(parts))
        if text:
            rendered.append(text)

    return "\n".join(rendered)


CHOICE_RE = re.compile(r"^\s*([A-D])(?:[.\s、]+)(.*)$")
CIRCLED_CHOICE_RE = re.compile(r"^\s*[①②③④]\s*(.*)$")


def parse_question_block(text: str) -> tuple[str, dict[str, str]]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    while lines and re.fullmatch(r"\d+\.", lines[0]):
        lines.pop(0)

    normalized_lines: list[str] = []
    index = 0
    while index < len(lines):
        if (
            index + 1 < len(lines)
            and re.fullmatch(r"[A-D]", lines[index + 1])
            and (lines[index + 1] in "BCD" or lines[index].startswith(("$", "(", "（", "H_", "H_{")))
        ):
            normalized_lines.append(f"{lines[index + 1]} {lines[index]}")
            index += 2
            continue
        normalized_lines.append(lines[index])
        index += 1
    lines = normalized_lines

    stem_lines: list[str] = []
    choices: dict[str, list[str]] = {}
    current: str | None = None
    for line in lines:
        line = line.replace("【答案】", "").strip()
        match = CHOICE_RE.match(line)
        if match and not line.startswith(("A,", "A，")):
            label, rest = match.groups()
            current = label
            choices.setdefault(label, [])
            if rest.strip():
                choices[label].append(rest.strip())
            continue
        circled_match = CIRCLED_CHOICE_RE.match(line)
        if circled_match and not choices:
            current = "A"
            choices.setdefault(current, [])
            rest = circled_match.group(1).strip()
            if rest:
                choices[current].append(rest)
            continue
        if current and len(choices) < 4:
            choices[current].append(line)
        else:
            stem_lines.append(line)

    if not choices:
        for index, line in enumerate(list(stem_lines)):
            if "\\textcircled" not in line:
                continue
            body = line.strip().strip("$")
            body = re.sub(r"\\begin\{aligned\}", "", body)
            body = re.sub(r"\\end\{aligned\}", "", body)
            body = re.sub(r"\\begin\{array\}\{[^}]*\}", "", body)
            body = re.sub(r"\\end\{array\}", "", body)
            parts = [part.strip() for part in re.split(r"\\\\", body) if part.strip()]
            parts = [part.strip("{} ") for part in parts if "\\textcircled" in part]
            if len(parts) >= 4:
                for label, part in zip("ABCD", parts[:4]):
                    part = re.sub(r"^&?\\textcircled\{[^}]*\}\\quad\s*", "", part).strip()
                    part = part.strip("{} ")
                    choices[label] = [f"${part}$"]
                stem_lines.pop(index)
                break

    if (("A" not in choices) or (not "".join(choices.get("A", [])).strip())) and all(label in choices for label in "BCD") and stem_lines:
        if stem_lines[-1].startswith("$"):
            choices["A"] = [stem_lines.pop()]
        elif stem_lines[-1] == "A" and len(stem_lines) >= 2 and stem_lines[-2].startswith(("$", "(", "（")):
            stem_lines.pop()
            choices["A"] = [stem_lines.pop()]
        elif stem_lines[-1].startswith(("(", "（", "$", "\\(")):
            choices["A"] = [stem_lines.pop()]
        elif "A" not in choices:
            choices["A"] = [stem_lines.pop()]

    parsed = {label: "\n".join(choices.get(label, [])).strip() for label in "ABCD"}
    if not all(parsed.values()):
        raise RuntimeError(f"Could not parse four choices from:\n{text}")

    stem = "\n".join(stem_lines).strip()
    stem = re.sub(r"\s+\(\s*\)\s*\.?", " ( ).", stem)
    return stem, parsed


def parse_analysis_block(text: str) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if lines and "解析" in lines[0]:
        lines.pop(0)
    return "\n".join(lines).strip() or "暂无解析"


def make_choices(chapter_id: int, question_no: int, choices: dict[str, str], answer_label: str) -> list[dict]:
    answer_digit = str("ABCD".index(answer_label) + 1)
    result = []
    for index, label in enumerate("ABCD", 1):
        result.append(
            {
                "id": chapter_id * 10000 + question_no * 10 + index,
                "question_id": chapter_id * 1000 + question_no,
                "is_answer": str(index) == answer_digit,
                "choice": choices[label],
                "choice_render_type": 1,
                "choice_id": str(index),
                "created_at": {"seconds": CREATED_SECONDS},
                "updated_at": {"seconds": CREATED_SECONDS},
            }
        )
    return result


def chunked(items: list[dict], size: int = 10) -> list[list[dict]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def make_raw_pages(questions: list[dict]) -> list[dict]:
    total = len(questions)
    return [{"code": 200, "message": "OK", "data": {"total": total, "questions": chunk}} for chunk in chunked(questions)]


def build_json(builds: dict[tuple[int, int], QuestionBuild]) -> list[dict]:
    summary = []
    for chapter_id, _, _, expected_total in TARGETS:
        questions: list[dict] = []
        for question_no in range(1, expected_total + 1):
            build = builds[(chapter_id, question_no)]
            question_text = "\n".join(merge_crop_text(name) for name in build.question_slices)
            analysis_text = "\n".join(merge_crop_text(name) for name in build.analysis_slices)
            manual = MANUAL_FIXES.get((chapter_id, question_no), {})
            try:
                stem, choices = parse_question_block(question_text)
            except RuntimeError:
                if "choices" not in manual:
                    raise
                stem_lines = [
                    line.strip()
                    for line in question_text.splitlines()
                    if line.strip() and not re.fullmatch(r"\d+\.", line.strip())
                ]
                first_choice = next(
                    (
                        index
                        for index, line in enumerate(stem_lines)
                        if CHOICE_RE.match(line) or CIRCLED_CHOICE_RE.match(line)
                    ),
                    len(stem_lines),
                )
                stem = "\n".join(stem_lines[:first_choice]).strip()
                choices = {label: "" for label in "ABCD"}
            if "choices" in manual:
                choices.update(manual["choices"])  # type: ignore[arg-type]
            answer_digit = str("ABCD".index(build.answer_label) + 1)
            questions.append(
                {
                    "id": chapter_id * 1000 + question_no,
                    "subject_id": 3,
                    "chapter_id": chapter_id,
                    "question_id": f"pdf-ocr-{chapter_id}-{question_no:03d}",
                    "difficulty": "OCR",
                    "answer": answer_digit,
                    "question_type": 1,
                    "question": stem,
                    "analysis": parse_analysis_block(analysis_text),
                    "question_render_type": 1,
                    "analysis_render_type": 1,
                    "created_at": {"seconds": CREATED_SECONDS},
                    "question_json": f"pdf-ocr/{chapter_id}/{question_no:03d}",
                    "updated_at": {"seconds": CREATED_SECONDS},
                    "version": 1,
                    "is_active_version": True,
                    "choices": make_choices(chapter_id, question_no, choices, build.answer_label),
                    "accuracy_rate": None,
                    "difficulty_score": None,
                    "avg_time_spent": None,
                    "ai_tags": "PDF OCR",
                    "tags": "PDF OCR",
                }
            )

        output_path = CHAPTER_DIR / f"neumathe_chapter_{chapter_id}_raw.json"
        output_path.write_text(json.dumps(make_raw_pages(questions), ensure_ascii=False, indent=2), encoding="utf-8")
        summary.append({"chapter_id": chapter_id, "questions": len(questions), "output": str(output_path)})
    return summary


def main() -> None:
    builds_path = WORK_DIR / "builds.json"
    if os.environ.get("REUSE_OCR") == "1" and builds_path.exists():
        raw_builds = json.loads(builds_path.read_text(encoding="utf-8"))
        builds = {}
        for key, value in raw_builds.items():
            chapter_id, question_no = [int(part) for part in key.split("-")]
            builds[(chapter_id, question_no)] = QuestionBuild(**value)
    else:
        builds = generate_crops()
        run_paddle()
    summary = build_json(builds)
    (WORK_DIR / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
