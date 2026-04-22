"""Generate deterministic local fixture PDFs for text_run and image_xobject tests."""

from __future__ import annotations

import io
import json
from pathlib import Path

import fitz
from PIL import Image, ImageDraw


FIXTURE_NAMES = {
    "header": "repeated_header_text.pdf",
    "footer": "repeated_footer_text.pdf",
    "brand": "repeated_small_brand_text.pdf",
    "unsupported_non_repeated": "unsupported_non_repeated_text.pdf",
    "unsupported_flattened": "unsupported_flattened_case.pdf",
    "image_corner_logo": "repeated_corner_logo_image.pdf",
    "image_small_brand_icon": "repeated_small_brand_icon.pdf",
    "image_unsupported_full_page": "unsupported_full_page_image.pdf",
    "example_plan_text": "example_plan_header_text.json",
    "example_plan_image": "example_plan_corner_logo_image.json",
}


def generate_all_fixtures(base_dir: Path) -> dict[str, Path]:
    base_dir.mkdir(parents=True, exist_ok=True)

    header_pdf = base_dir / FIXTURE_NAMES["header"]
    footer_pdf = base_dir / FIXTURE_NAMES["footer"]
    brand_pdf = base_dir / FIXTURE_NAMES["brand"]
    unsupported_non_repeated_pdf = base_dir / FIXTURE_NAMES["unsupported_non_repeated"]
    unsupported_flattened_pdf = base_dir / FIXTURE_NAMES["unsupported_flattened"]
    image_corner_logo_pdf = base_dir / FIXTURE_NAMES["image_corner_logo"]
    image_small_brand_icon_pdf = base_dir / FIXTURE_NAMES["image_small_brand_icon"]
    image_unsupported_full_page_pdf = base_dir / FIXTURE_NAMES["image_unsupported_full_page"]

    _build_repeated_header_pdf(header_pdf)
    _build_repeated_footer_pdf(footer_pdf)
    _build_repeated_small_brand_pdf(brand_pdf)
    _build_unsupported_non_repeated_text_pdf(unsupported_non_repeated_pdf)
    _build_unsupported_flattened_case_pdf(unsupported_flattened_pdf)

    _build_repeated_corner_logo_image_pdf(image_corner_logo_pdf)
    _build_repeated_small_brand_icon_image_pdf(image_small_brand_icon_pdf)
    _build_unsupported_full_page_image_pdf(image_unsupported_full_page_pdf)

    from parsers.pdf_objects import analysis_result_to_dict, analyze_pdf_candidates

    _write_example_plan(
        output_path=base_dir / FIXTURE_NAMES["example_plan_text"],
        source_pdf=header_pdf,
        analysis=analysis_result_to_dict(analyze_pdf_candidates(header_pdf)),
        object_type="text_run",
        contains_text="HEADER_TEXT_WATERMARK",
        target_pages=[1, 2, 3, 4],
    )

    _write_example_plan(
        output_path=base_dir / FIXTURE_NAMES["example_plan_image"],
        source_pdf=image_corner_logo_pdf,
        analysis=analysis_result_to_dict(analyze_pdf_candidates(image_corner_logo_pdf)),
        object_type="image_xobject",
        contains_text=None,
        target_pages=[1, 2, 3, 4],
    )

    return {
        "header": header_pdf,
        "footer": footer_pdf,
        "brand": brand_pdf,
        "unsupported_non_repeated": unsupported_non_repeated_pdf,
        "unsupported_flattened": unsupported_flattened_pdf,
        "image_corner_logo": image_corner_logo_pdf,
        "image_small_brand_icon": image_small_brand_icon_pdf,
        "image_unsupported_full_page": image_unsupported_full_page_pdf,
        "example_plan": base_dir / FIXTURE_NAMES["example_plan_text"],
        "example_plan_image": base_dir / FIXTURE_NAMES["example_plan_image"],
    }


def _write_example_plan(
    *,
    output_path: Path,
    source_pdf: Path,
    analysis: dict,
    object_type: str,
    contains_text: str | None,
    target_pages: list[int],
) -> None:
    repeat_groups = [
        group
        for group in analysis["repeatGroups"]
        if group["removability"] == "supported" and group.get("objectType") == object_type
    ]
    if not repeat_groups:
        return

    repeat_key = repeat_groups[0]["repeatKey"]
    selected = None
    for page in sorted(analysis["candidatesByPage"], key=lambda p: int(p)):
        for candidate in analysis["candidatesByPage"][page]:
            if candidate.get("objectType") != object_type:
                continue
            if candidate.get("repeatKey") != repeat_key:
                continue
            if contains_text and contains_text.lower() not in candidate.get("text", "").lower():
                continue
            selected = candidate
            break
        if selected:
            break

    if not selected:
        return

    selected_candidate = {
        "id": selected["id"],
        "pageNumber": selected["pageNumber"],
        "objectType": selected["objectType"],
        "label": selected["label"],
        "repeatKey": selected["repeatKey"],
        "confidence": selected["confidence"],
        "removability": selected["removability"],
    }
    if object_type == "image_xobject":
        selected_candidate["imageIdentityKey"] = selected.get("imageIdentityKey")
        selected_candidate["resourceName"] = selected.get("resourceName")

    plan = {
        "planVersion": "1.0",
        "createdAt": "2026-04-20T00:00:00Z",
        "sourceFileName": source_pdf.name,
        "selectedCandidate": selected_candidate,
        "scope": {
            "mode": "all",
            "targetPages": target_pages,
            "strategy": "all_matching_repeat_key",
        },
        "preferredEngines": ["pikepdf", "PyMuPDF"],
        "preservationGoal": "Preserve original page appearance as much as possible.",
        "engineHints": ["Current engine MVP supports text_run and image_xobject only."],
        "riskLevel": "low",
        "notes": ["Synthetic fixture example plan."],
    }
    output_path.write_text(
        json.dumps(plan, indent=2, ensure_ascii=False, sort_keys=True), encoding="utf-8"
    )


def _build_repeated_header_pdf(path: Path) -> None:
    _build_text_fixture(
        path=path,
        repeated_text="HEADER_TEXT_WATERMARK",
        repeated_position="header",
        page_count=4,
        font_size=10,
    )


def _build_repeated_footer_pdf(path: Path) -> None:
    _build_text_fixture(
        path=path,
        repeated_text="FOOTER_TEXT_WATERMARK",
        repeated_position="footer",
        page_count=4,
        font_size=10,
    )


def _build_repeated_small_brand_pdf(path: Path) -> None:
    _build_text_fixture(
        path=path,
        repeated_text="BRAND_TXT",
        repeated_position="corner",
        page_count=4,
        font_size=8,
    )


def _build_unsupported_non_repeated_text_pdf(path: Path) -> None:
    with fitz.open() as doc:
        for index in range(4):
            page = doc.new_page()
            page.insert_text((72, 40), f"UNIQUE_HEADER_{index + 1}", fontsize=10)
            page.insert_text((72, 110), f"Body line page {index + 1}", fontsize=14)
        doc.save(path)


def _build_unsupported_flattened_case_pdf(path: Path) -> None:
    with fitz.open() as source:
        for index in range(3):
            page = source.new_page()
            page.insert_text((72, 40), "FLATTENED_MARK", fontsize=10)
            page.insert_text((72, 90), f"Flattened body content page {index + 1}", fontsize=13)

        with fitz.open() as flattened:
            for page in source:
                pix = page.get_pixmap(dpi=144, alpha=False)
                image_bytes = pix.tobytes("png")
                image_page = flattened.new_page(width=page.rect.width, height=page.rect.height)
                image_page.insert_image(image_page.rect, stream=image_bytes)

            flattened.save(path)


def _build_repeated_corner_logo_image_pdf(path: Path) -> None:
    logo_bytes = _build_logo_png_bytes((250, 88, 88), text="LG")
    with fitz.open() as doc:
        for index in range(4):
            page = doc.new_page()
            page.insert_text((72, 120), f"Body content page {index + 1}", fontsize=14)
            page.insert_text((72, 150), "Corner logo fixture content.", fontsize=12)
            logo_rect = fitz.Rect(page.rect.width - 96, 16, page.rect.width - 24, 52)
            page.insert_image(logo_rect, stream=logo_bytes)
        doc.save(path)


def _build_repeated_small_brand_icon_image_pdf(path: Path) -> None:
    icon_bytes = _build_logo_png_bytes((76, 148, 255), text="B")
    with fitz.open() as doc:
        for index in range(4):
            page = doc.new_page()
            page.insert_text((72, 120), f"Body content page {index + 1}", fontsize=14)
            page.insert_text((72, 150), "Small brand icon fixture content.", fontsize=12)
            icon_rect = fitz.Rect(18, 18, 46, 46)
            page.insert_image(icon_rect, stream=icon_bytes)
        doc.save(path)


def _build_unsupported_full_page_image_pdf(path: Path) -> None:
    background = _build_background_png_bytes(1240, 1754)
    with fitz.open() as doc:
        for _ in range(3):
            page = doc.new_page()
            page.insert_image(page.rect, stream=background)
        doc.save(path)


def _build_logo_png_bytes(color: tuple[int, int, int], text: str) -> bytes:
    image = Image.new("RGB", (160, 80), color=color)
    draw = ImageDraw.Draw(image)
    draw.rectangle((4, 4, 155, 75), outline=(255, 255, 255), width=3)
    draw.text((58, 28), text, fill=(255, 255, 255))

    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def _build_background_png_bytes(width: int, height: int) -> bytes:
    image = Image.new("RGB", (width, height), color=(245, 247, 252))
    draw = ImageDraw.Draw(image)
    for y in range(0, height, 64):
        draw.line((0, y, width, y), fill=(224, 228, 236), width=1)
    draw.text((60, 80), "FULL PAGE IMAGE BACKGROUND", fill=(80, 88, 108))

    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def _build_text_fixture(
    *,
    path: Path,
    repeated_text: str,
    repeated_position: str,
    page_count: int,
    font_size: int,
) -> None:
    with fitz.open() as doc:
        for index in range(page_count):
            page = doc.new_page()
            x, y = _position_for(page, repeated_position)
            page.insert_text((x, y), repeated_text, fontsize=font_size)
            page.insert_text((72, 120), f"Body content page {index + 1}", fontsize=14)
            page.insert_text((72, 150), "Lorem ipsum dolor sit amet.", fontsize=12)
        doc.save(path)


def _position_for(page: fitz.Page, repeated_position: str) -> tuple[float, float]:
    if repeated_position == "header":
        return (72.0, 40.0)
    if repeated_position == "footer":
        return (72.0, page.rect.height - 28.0)
    if repeated_position == "corner":
        return (page.rect.width - 120.0, 30.0)
    raise ValueError(f"Unknown repeated_position: {repeated_position}")


def main() -> int:
    base_dir = Path(__file__).resolve().parent / "fixtures"
    generated = generate_all_fixtures(base_dir)
    for name, path in generated.items():
        print(f"[fixtures] {name}: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
