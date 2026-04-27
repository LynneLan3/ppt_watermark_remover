#!/usr/bin/env python3
"""Extract canonical page commands from PDF content streams using pikepdf."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pikepdf
from pikepdf import parse_content_stream


TEXT_SHOW_OPERATORS = {"Tj", "TJ", "'", '"'}
VECTOR_PATH_OPS = {"m", "l", "c", "v", "y", "h", "re"}
VECTOR_PAINT_OPS = {"S", "s", "f", "F", "f*", "B", "B*", "b", "b*", "n", "W", "W*"}
VECTOR_STATE_OPS = {"cm", "w", "J", "j", "M", "d", "ri", "i", "gs", "RG", "G", "K", "rg", "g", "k"}


@dataclass
class TextState:
    in_text: bool = False
    block_seq: int = 0
    text_block_id: str | None = None
    font_name: str | None = None
    font_size: float | None = None
    text_matrix: list[float] | None = None
    text_line_matrix: list[float] | None = None


@dataclass
class GraphicState:
    ctm: list[float]
    stroke_color: str | None = None
    fill_color: str | None = None
    line_width: float | None = None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Extract page command model from PDF")
    parser.add_argument("--input", required=True, type=Path, help="Source PDF path")
    parser.add_argument("--output", required=True, type=Path, help="Output page-commands.v1.json")
    parser.add_argument(
        "--pages",
        required=False,
        default="",
        help="Optional page range list. Example: 1-3,7,9-10",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    selected_pages = parse_page_range(args.pages)
    payload = extract_page_commands(args.input, selected_pages)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True),
        encoding="utf-8",
    )
    return 0


def extract_page_commands(input_pdf: Path, selected_pages: set[int] | None) -> dict[str, Any]:
    commands: list[dict[str, Any]] = []

    with pikepdf.open(input_pdf) as pdf:
        total_pages = len(pdf.pages)
        for page_index, page in enumerate(pdf.pages, start=1):
            if selected_pages and page_index not in selected_pages:
                continue
            instructions = list(parse_content_stream(page))
            page_commands = extract_page_instruction_commands(page_index, instructions)
            commands.extend(page_commands)

    # attach command windows (optional enhancement)
    by_page: dict[int, list[dict[str, Any]]] = {}
    for command in commands:
        by_page.setdefault(int(command["page"]), []).append(command)
    for _, page_commands in by_page.items():
        page_commands.sort(key=lambda item: int(item["commandIndex"]))
        for idx, command in enumerate(page_commands):
            before = [item["operatorName"] for item in page_commands[max(0, idx - 2) : idx]]
            after = [item["operatorName"] for item in page_commands[idx + 1 : idx + 3]]
            command["commandWindowBefore"] = before
            command["commandWindowAfter"] = after

    return {
        "version": "v1",
        "generatedAt": iso_now(),
        "sourcePdfPath": str(input_pdf),
        "totalPages": total_pages,
        "pageCommands": sorted(commands, key=lambda item: (item["page"], item["commandIndex"])),
    }


def extract_page_instruction_commands(page: int, instructions: list[Any]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    depth = 0
    gstate_stack: list[GraphicState] = [GraphicState(ctm=[1, 0, 0, 1, 0, 0])]
    text_state = TextState()
    current_path_points: list[tuple[float, float]] = []

    for index, instruction in enumerate(instructions):
        op_name = operator_name(instruction)
        operands = instruction_operands(instruction)
        operands_raw = json.dumps(stringify_operands(operands), ensure_ascii=False)

        if op_name == "q":
            depth += 1
            gstate_stack.append(clone_gstate(gstate_stack[-1]))
        elif op_name == "Q":
            depth = max(0, depth - 1)
            if len(gstate_stack) > 1:
                gstate_stack.pop()
        elif op_name == "cm":
            matrix = to_six_numbers(operands)
            if matrix is not None:
                gstate_stack[-1].ctm = matrix
        elif op_name == "w":
            if operands:
                gstate_stack[-1].line_width = safe_float(operands[0], 0.0)
        elif op_name in {"RG", "G", "K"}:
            gstate_stack[-1].stroke_color = operands_raw
        elif op_name in {"rg", "g", "k"}:
            gstate_stack[-1].fill_color = operands_raw

        if op_name == "BT":
            text_state.in_text = True
            text_state.block_seq += 1
            text_state.text_block_id = f"{page}-tb-{text_state.block_seq}"
            text_state.text_matrix = [1, 0, 0, 1, 0, 0]
            text_state.text_line_matrix = [1, 0, 0, 1, 0, 0]
        elif op_name == "ET":
            text_state.in_text = False
        elif op_name == "Tf" and len(operands) >= 2:
            text_state.font_name = normalize_resource_name(operands[0])
            text_state.font_size = safe_float(operands[1], None)
        elif op_name == "Tm":
            matrix = to_six_numbers(operands)
            if matrix is not None:
                text_state.text_matrix = matrix
                text_state.text_line_matrix = matrix
        elif op_name == "Td" and len(operands) >= 2:
            tx = safe_float(operands[0], 0.0)
            ty = safe_float(operands[1], 0.0)
            text_state.text_line_matrix = translate_matrix(text_state.text_line_matrix, tx, ty)
            text_state.text_matrix = text_state.text_line_matrix.copy() if text_state.text_line_matrix else None
        elif op_name == "T*":
            text_state.text_matrix = text_state.text_line_matrix.copy() if text_state.text_line_matrix else None

        if op_name in VECTOR_PATH_OPS:
            path_points = infer_points_from_path_command(op_name, operands)
            current_path_points.extend(path_points)

        operator_type = classify_operator_type(op_name, text_state.in_text)
        if operator_type is None:
            continue

        bbox = infer_bbox(
            operator_name=op_name,
            operands=operands,
            text_state=text_state,
            gstate=gstate_stack[-1],
            current_path_points=current_path_points,
        )

        decoded_text = decode_text(op_name, operands)
        normalized_text = normalize_text(decoded_text) if decoded_text else None

        command = {
            "page": page,
            "commandIndex": index,
            "operatorName": op_name,
            "operatorType": operator_type,
            "operandsRaw": operands_raw,
            "resourceName": infer_resource_name(op_name, operands),
            "graphicsDepth": depth,
            "ctm": to_serializable_matrix(gstate_stack[-1].ctm),
            "textBlockId": text_state.text_block_id if text_state.in_text else None,
            "fontName": text_state.font_name if text_state.in_text else None,
            "fontSize": text_state.font_size if text_state.in_text else None,
            "decodedText": decoded_text,
            "normalizedText": normalized_text,
            "bbox": bbox,
            "strokeColor": gstate_stack[-1].stroke_color,
            "fillColor": gstate_stack[-1].fill_color,
            "lineWidth": gstate_stack[-1].line_width,
            "textMatrix": to_serializable_matrix(text_state.text_matrix),
            "textLineMatrix": to_serializable_matrix(text_state.text_line_matrix),
        }
        output.append(command)

        if op_name in VECTOR_PAINT_OPS:
            current_path_points = []

    return output


def classify_operator_type(op_name: str, in_text: bool) -> str | None:
    if op_name == "Do":
        return "xobject_do"
    if op_name in VECTOR_PATH_OPS or op_name in VECTOR_PAINT_OPS or op_name in VECTOR_STATE_OPS:
        return "vector_paint"
    if in_text and op_name in TEXT_SHOW_OPERATORS:
        return "text_show"
    if op_name in {"BT", "ET"}:
        return "text_block"
    return None


def infer_bbox(
    *,
    operator_name: str,
    operands: list[Any],
    text_state: TextState,
    gstate: GraphicState,
    current_path_points: list[tuple[float, float]],
) -> dict[str, float]:
    if operator_name == "Do":
        ctm = gstate.ctm
        x = ctm[4]
        y = ctm[5]
        width = abs(ctm[0]) if abs(ctm[0]) > 0 else 0.08
        height = abs(ctm[3]) if abs(ctm[3]) > 0 else 0.08
        return normalize_bbox(x, y, width, height)
    if operator_name in VECTOR_PAINT_OPS and current_path_points:
        xs = [point[0] for point in current_path_points]
        ys = [point[1] for point in current_path_points]
        return normalize_bbox(min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))
    if operator_name in TEXT_SHOW_OPERATORS:
        tm = text_state.text_matrix or [1, 0, 0, 1, 0, 0]
        x = tm[4]
        y = tm[5]
        width = estimate_text_width(operands, text_state.font_size)
        height = (text_state.font_size or 12.0) * 1.2
        return normalize_bbox(x, y, width, height)
    return normalize_bbox(0, 0, 0.02, 0.02)


def infer_resource_name(op_name: str, operands: list[Any]) -> str:
    if op_name == "Do" and operands:
        return normalize_resource_name(operands[-1]) or "UNKNOWN_XOBJECT"
    return "N/A"


def infer_points_from_path_command(op_name: str, operands: list[Any]) -> list[tuple[float, float]]:
    if op_name == "re" and len(operands) >= 4:
        x = safe_float(operands[0], 0.0)
        y = safe_float(operands[1], 0.0)
        w = safe_float(operands[2], 0.0)
        h = safe_float(operands[3], 0.0)
        return [(x, y), (x + w, y), (x, y + h), (x + w, y + h)]
    if op_name in {"m", "l"} and len(operands) >= 2:
        return [(safe_float(operands[0], 0.0), safe_float(operands[1], 0.0))]
    if op_name in {"c", "v", "y"} and len(operands) >= 2:
        points = []
        for idx in range(0, len(operands), 2):
            if idx + 1 < len(operands):
                points.append((safe_float(operands[idx], 0.0), safe_float(operands[idx + 1], 0.0)))
        return points
    return []


def decode_text(op_name: str, operands: list[Any]) -> str | None:
    if op_name not in TEXT_SHOW_OPERATORS:
        return None
    if op_name == "TJ" and operands:
        arr = operands[0]
        if isinstance(arr, (list, tuple)):
            chunks = [str(item) for item in arr if not isinstance(item, (int, float))]
            return "".join(chunks)
    if operands:
        return str(operands[0])
    return ""


def estimate_text_width(operands: list[Any], font_size: float | None) -> float:
    text = decode_text("Tj", operands) or ""
    fs = font_size or 12.0
    return max(0.01, len(text) * fs * 0.55)


def normalize_text(text: str) -> str:
    return " ".join(text.strip().lower().split())


def normalize_bbox(x: float, y: float, width: float, height: float) -> dict[str, float]:
    # keep normalized-like coordinates using quantization/clamping.
    nx = clamp(x / 1000.0)
    ny = clamp(y / 1000.0)
    nw = clamp(abs(width) / 1000.0)
    nh = clamp(abs(height) / 1000.0)
    return {"x": round(nx, 6), "y": round(ny, 6), "width": round(nw, 6), "height": round(nh, 6)}


def to_six_numbers(operands: list[Any]) -> list[float] | None:
    if len(operands) < 6:
        return None
    return [safe_float(operands[idx], 0.0) for idx in range(6)]


def translate_matrix(matrix: list[float] | None, tx: float, ty: float) -> list[float] | None:
    if matrix is None or len(matrix) != 6:
        return None
    out = matrix.copy()
    out[4] = out[4] + tx
    out[5] = out[5] + ty
    return out


def to_serializable_matrix(matrix: list[float] | None) -> list[float] | None:
    if matrix is None or len(matrix) != 6:
        return None
    return [round(float(value), 6) for value in matrix]


def operator_name(instruction: Any) -> str:
    op = None
    if hasattr(instruction, "operator"):
        op = getattr(instruction, "operator")
    elif isinstance(instruction, (list, tuple)) and len(instruction) >= 2:
        op = instruction[1]
    if op is None:
        return ""
    value = str(op).strip()
    return value[1:] if value.startswith("/") else value


def instruction_operands(instruction: Any) -> list[Any]:
    if hasattr(instruction, "operands"):
        operands = getattr(instruction, "operands")
        return list(operands or [])
    if isinstance(instruction, (list, tuple)) and len(instruction) >= 1:
        maybe = instruction[0]
        if isinstance(maybe, (list, tuple)):
            return list(maybe)
        return [maybe]
    return []


def stringify_operands(values: list[Any]) -> list[Any]:
    result: list[Any] = []
    for value in values:
        if isinstance(value, (int, float, str, bool)) or value is None:
            result.append(value)
        elif isinstance(value, (list, tuple)):
            result.append([str(item) for item in value])
        else:
            result.append(str(value))
    return result


def normalize_resource_name(value: Any) -> str:
    text = str(value).strip()
    return text[1:] if text.startswith("/") else text


def clone_gstate(state: GraphicState) -> GraphicState:
    return GraphicState(
        ctm=state.ctm.copy(),
        stroke_color=state.stroke_color,
        fill_color=state.fill_color,
        line_width=state.line_width,
    )


def parse_page_range(raw: str) -> set[int] | None:
    value = raw.strip()
    if not value:
        return None
    pages: set[int] = set()
    for chunk in value.split(","):
        part = chunk.strip()
        if not part:
            continue
        if "-" in part:
            start_raw, end_raw = part.split("-", 1)
            start = int(start_raw)
            end = int(end_raw)
            lo, hi = (start, end) if start <= end else (end, start)
            for page in range(lo, hi + 1):
                if page > 0:
                    pages.add(page)
            continue
        single = int(part)
        if single > 0:
            pages.add(single)
    return pages


def safe_float(value: Any, fallback: float | None) -> float | None:
    try:
        return float(value)
    except Exception:  # pylint: disable=broad-except
        return fallback


def clamp(value: float) -> float:
    if value < 0:
        return 0.0
    if value > 1:
        return 1.0
    return value


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


if __name__ == "__main__":
    raise SystemExit(main())
