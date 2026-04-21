import sys
from pathlib import Path

from PIL import Image


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("usage: convert_image.py <input> <output>")

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with Image.open(input_path) as image:
        if image.mode not in {"RGB", "RGBA", "L", "LA"}:
            image = image.convert("RGBA" if "A" in image.getbands() else "RGB")

        if image.mode == "LA":
            image = image.convert("RGBA")

        image.save(output_path)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
