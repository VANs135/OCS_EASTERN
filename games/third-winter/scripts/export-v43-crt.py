"""Extract the Combat Table from the local English OCS Charts & Tables v4.3 PDF."""

import json
import re
import sys
from pathlib import Path

import fitz


def extract(source):
    with fitz.open(source) as pdf:
        page = pdf[2]
        text = page.get_text()
        if "Combat Table (9.9)" not in text or "v4.3 (page 3)" not in text:
            raise ValueError("Expected the English OCS v4.3 Combat Table on PDF page 3")

        # Column borders on the published 792 × 612 point page.
        bounds = [82.5, 126.2, 169.7, 213.4, 257.1, 300.9, 351.9,
                  402.8, 453.8, 504.9, 555.9, 606.9, 657.9, 709.0]
        words = page.get_text("words")

        def cell(column, top, bottom):
            left, right = bounds[column:column + 2]
            inside = [row for row in words
                      if left < (row[0] + row[2]) / 2 < right
                      and top < (row[1] + row[3]) / 2 < bottom]
            return " ".join(word[4] for word in sorted(inside, key=lambda row: (round(row[1], 1), row[0])))

        terrains = ["Extr Close", "Very Close", "Close", "Open"]
        terrain_columns = {name: [cell(c, 69.1 + i * 17.9, 69.1 + (i + 1) * 17.9)
                                  for c in range(13)] for i, name in enumerate(terrains)}
        matrix = [[cell(c, 144.2 + i * 25.62, 144.2 + (i + 1) * 25.62)
                   for c in range(13)] for i in range(15)]
        for labels in terrain_columns.values():
            if any(not re.fullmatch(r"[1-9]\d*:[1-9]\d*", label) for label in labels):
                raise ValueError("Could not extract all 13 odds columns")
        grammar = r"A(?:L[1-9])?(?:o[1-9])?(?:\s*e[1-5])?(?: D(?:L[1-9])?(?:o[1-9])?(?:DG)?)?"
        if any(not re.fullmatch(grammar, code) for row in matrix for code in row):
            raise ValueError("Could not extract the printed results for all 195 cells")
        if matrix[0][0] != "AL2" or matrix[8][8] != "Ao1 e4 DL1o2" or matrix[14][-1] != "Ae2 DL2o3DG":
            raise ValueError("Combat Table cells did not align with the published page")
        return {"diceRows": ["1 or less", *(str(i) for i in range(2, 15)), "15 or more"],
                "terrainColumns": terrain_columns, "matrix": matrix}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python export-v43-crt.py OCS_Chartsv4.3.pdf output.json")
    table = extract(Path(sys.argv[1]))
    with Path(sys.argv[2]).open("x", encoding="utf-8") as output:
        json.dump(table, output, ensure_ascii=False, indent=2)
