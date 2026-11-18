"""Extract the regular Barrage Table from the local English OCS v4.3 chart."""

import json
import re
import sys
from pathlib import Path

import fitz


def extract(source, facility=False):
    with fitz.open(source) as pdf:
        page = pdf[3]
        if "Barrage Table (10.0a)" not in page.get_text() or "v4.3 (page 4)" not in page.get_text():
            raise ValueError("Expected the English OCS v4.3 Barrage Table on PDF page 4")
        words = page.get_text("words")
        centers = ([79.5, 122, 162, 201, 241, 281, 321, 360] if facility else
                   [85, 126, 163, 200, 237, 274, 310, 347, 384, 421, 461])

        def row(height):
            return [" ".join(word[4] for word in sorted(words)
                             if abs((word[0] + word[2]) / 2 - center) < 19
                             and abs((word[1] + word[3]) / 2 - height) < 6)
                    for center in centers]

        columns = row(453.6 if facility else 81)
        costs = row(471.6 if facility else 100)
        matrix = ([row(488.7 + index * 17) for index in range(6)] if facility else
                  [row(117 + index * 17.72) for index in range(11)])
        if columns[0] != "1 or less" or columns[-1] != ("81+" if facility else "117+") or any(
            not re.fullmatch(r"\d+(?:-\d+|\+)?", label) for label in columns[1:]
        ):
            raise ValueError("Could not extract every Barrage Strength column")
        if any(not re.fullmatch(r"\d+T", cost) for cost in costs):
            raise ValueError("Could not extract every printed token cost")
        grammar = r"-(?:$)|(?:[12] )?(?:S )?\([3-6]\)" if facility else r"-|DG|1/2|\[1/2\]|[123]"
        if any(not re.fullmatch(grammar, code) for cells in matrix for code in cells):
            raise ValueError("Could not extract every Barrage Table result")
        anchors = ((matrix[0][0], matrix[3][3], matrix[-1][-1]) == ("-", "S (6)", "2 S (3)") if facility else
                   (matrix[0][0], matrix[6][7], matrix[-1][-1]) == ("-", "[1/2]", "3"))
        if not anchors:
            raise ValueError("Barrage Table cells did not align with the published page")
        return {"columns": columns, "costs": [int(cost[:-1]) for cost in costs], "matrix": matrix}


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4) or (len(sys.argv) == 4 and sys.argv[3] != "--facility"):
        raise SystemExit("Usage: python export-v43-barrage.py OCS_Chartsv4.3.pdf output.json [--facility]")
    table = extract(Path(sys.argv[1]), facility=len(sys.argv) == 4)
    with Path(sys.argv[2]).open("x", encoding="utf-8") as output:
        json.dump(table, output, ensure_ascii=False, indent=2)
