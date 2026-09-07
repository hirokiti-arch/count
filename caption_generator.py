#!/usr/bin/env python3
"""
ショート動画キャプション生成ツール
動画テーマ・感情・CTAを入力してキャプションを生成する
"""

import json
from dataclasses import dataclass
from typing import Optional


@dataclass
class CaptionInput:
    theme: str           # 動画のテーマ（例：復縁、転職、ダイエット）
    hook: str            # 冒頭フック（視聴者の共感を引く一言）
    target_pain: str     # ターゲットの悩み・状況
    insight: str         # 動画で伝えるインサイト
    cta_comment: str     # コメント誘導の文
    cta_dm: Optional[str] = None    # DM誘導の文
    cta_line: Optional[str] = None  # LINE誘導の文
    hashtags: list[str] = None      # ハッシュタグリスト

    def __post_init__(self):
        if self.hashtags is None:
            self.hashtags = []


def generate_caption(inp: CaptionInput) -> str:
    lines = []

    # フック（1〜2行、読者を引き込む）
    lines.append(inp.hook)
    lines.append("")

    # インサイト（価値提供）
    lines.append(inp.insight)
    lines.append("")

    # コメントCTA
    lines.append(inp.cta_comment)

    # DM / LINE CTA
    if inp.cta_dm:
        lines.append(inp.cta_dm)
    if inp.cta_line:
        lines.append(inp.cta_line)

    # ハッシュタグ
    if inp.hashtags:
        lines.append("")
        lines.append(" ".join(f"#{tag.lstrip('#')}" for tag in inp.hashtags))

    return "\n".join(lines)


# ──────────────────────────────────────────
# テンプレート例
# ──────────────────────────────────────────

TEMPLATES = {
    "復縁": CaptionInput(
        theme="復縁",
        hook="別れて1週間の人も、1年の人も、実は同じスタートラインに立てます。\nただし1つだけ、本当に手遅れになるケースがあります。最後に連絡したのはいつですか？",
        target_pain="別れてから連絡を悩んでいる",
        insight="コメントで教えてください。",
        cta_comment="🎁あなたの状況に合わせて、無料でアドバイスします",
        cta_dm="DMに「復縁」と送るだけ。公式LINEで直接、無料相談もできます。",
        hashtags=["復縁", "復縁したい", "失恋", "冷却期間", "恋愛心理学", "復縁できる方法"],
    ),
    "転職": CaptionInput(
        theme="転職",
        hook="「年収上げたい」と思いながら3年が過ぎていませんか？\n実は転職成功者の9割は、ある1つの準備から動き始めています。",
        target_pain="転職を考えているが一歩踏み出せない",
        insight="コメントで今の悩みを教えてください。",
        cta_comment="🎁状況に合わせて無料アドバイスします",
        cta_dm="DMに「転職」と送るだけで詳しく相談できます。",
        hashtags=["転職", "転職活動", "キャリアアップ", "年収アップ", "転職成功"],
    ),
    "ダイエット": CaptionInput(
        theme="ダイエット",
        hook="食事制限しても痩せない人と、食べても痩せる人の違いは何でしょう？\n答えは「◯◯のタイミング」にあります。",
        target_pain="ダイエットが続かない、効果が出ない",
        insight="コメントで今の食生活を教えてください。",
        cta_comment="🎁あなたの体型に合わせた無料アドバイスをします",
        cta_dm="DMに「ダイエット」と送ってください。",
        hashtags=["ダイエット", "痩せる方法", "ダイエット方法", "筋トレ", "食事制限"],
    ),
}


def generate_from_template(template_name: str) -> str:
    if template_name not in TEMPLATES:
        raise ValueError(f"テンプレートが見つかりません: {template_name}\n利用可能: {list(TEMPLATES.keys())}")
    return generate_caption(TEMPLATES[template_name])


def caption_structure_guide() -> dict:
    """キャプション構成のガイドを返す"""
    return {
        "構成": [
            "① フック（1〜2行）: 視聴者の悩みや疑問を直撃する一言。数字・対比・問いかけが効果的",
            "② 空行: 読みやすさのため",
            "③ インサイト（1〜2行）: 動画で伝える価値・答えのヒント",
            "④ CTA（2〜3行）: コメント誘導 → DM誘導 → LINE誘導の順",
            "⑤ ハッシュタグ（5〜10個）: ジャンル + 具体キーワード + 感情ワード",
        ],
        "フックのパターン": [
            "対比型: 「〇〇な人も、△△な人も、実は〜」",
            "問いかけ型: 「最後に連絡したのはいつですか？」",
            "数字型: 「3つのうち1つでも当てはまったら〜」",
            "警告型: 「1つだけ、本当に手遅れになるケースがあります」",
            "共感型: 「〇〇しながら△年が過ぎていませんか？」",
        ],
        "CTAのポイント": [
            "コメント誘導は具体的な質問にする（はい/いいえ や 数字で答えられるもの）",
            "無料オファーを明示する（アドバイス、相談、診断など）",
            "DM/LINEはキーワード送信にする（「復縁」と送るだけ）",
        ],
        "動画を見なくてもキャプションが作れる理由": (
            "キャプションに必要なのは動画の映像ではなく「テーマ・ターゲットの感情・伝えたいメッセージ・CTA」です。"
            "動画の内容説明よりも、視聴者の感情に刺さるコピーライティングが重要です。"
        ),
    }


if __name__ == "__main__":
    import sys

    print("=" * 50)
    print("ショート動画キャプション生成ツール")
    print("=" * 50)

    # テンプレート一覧表示
    if len(sys.argv) > 1 and sys.argv[1] == "--guide":
        guide = caption_structure_guide()
        print(json.dumps(guide, ensure_ascii=False, indent=2))
        sys.exit(0)

    # 全テンプレートのキャプションを出力
    for name, template in TEMPLATES.items():
        print(f"\n【{name}テンプレート】")
        print("-" * 40)
        print(generate_caption(template))
        print()
