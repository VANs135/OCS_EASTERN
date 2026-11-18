"""Extract the regular Barrage Table from the local English OCS v4.3 chart."""

import json
import re
import sys
from pathlib import Path

import fitz


def extract(source):
    with fitz.open(source) as pdf:
        page = pdf[3]
        if "Barrage Table (10.0a)" not in page.get_text() or "v4.3 (page 4)" not in page.get_text():
            raise ValueError("Expected the English OCS v4.3 Barrage Table on PDF page 4")
        words = page.get_text("words")
        centers = [85, 126, 163, 200, 237, 274, 310, 347, 384, 421, 461]

        def row(height):
            return [" ".join(word[4] for word in sorted(words)
                             if abs((word[0] + word[2]) / 2 - center) < 19
                             and abs((word[1] + word[3]) / 2 - height) < 6)
                    for center in centers]

        columns = row(81)
        costs = row(100)
        matrix = [row(117 + index * 17.72) for index in range(11)]
        if columns[0] != "1 or less" or columns[-1] != "117+" or any(
            not re.fullmatch(r"\d+(?:-\d+|\+)?", label) for label in columns[1:]
        ):
            raise ValueError("Could not extract all 11 Barrage Strength columns")
        if any(not re.fullmatch(r"\d+T", cost) for cost in costs):
            raise ValueError("Could not extract all 11 printed token costs")
        if any(code not in {"-", "DG", "1/2", "[1/2]", "1", "2", "3"} for cells in matrix for code in cells):
            raise ValueError("Could not extract all 121 Barrage Table results")
        if matrix[0][0] != "-" or matrix[6][7] != "[1/2]" or matrix[-1][-1] != "3":
            raise ValueError("Barrage Table cells did not align with the published page")
        return {"columns": columns, "costs": [int(cost[:-1]) for cost in costs], "matrix": matrix}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python export-v43-barrage.py OCS_Chartsv4.3.pdf output.json")
    table = extract(Path(sys.argv[1]))
    with Path(sys.argv[2]).open("x", encoding="utf-8") as output:
        json.dump(table, output, ensure_ascii=False, indent=2)
