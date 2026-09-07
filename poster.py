#!/usr/bin/env python3
"""
TikTok 自動投稿ツール
"""

import os
import time
import argparse
import requests
from pathlib import Path
from caption_generator import generate_from_template


def tiktok_post_video(video_path: str, caption: str) -> dict:
    """TikTok に動画を投稿する（Direct Post）"""
    access_token = os.environ["TIKTOK_ACCESS_TOKEN"]
    file_size    = Path(video_path).stat().st_size

    # Step 1: アップロード初期化
    init_resp = requests.post(
        "https://open.tiktokapis.com/v2/post/publish/video/init/",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type":  "application/json; charset=UTF-8",
        },
        json={
            "post_info": {
                "title":                   caption[:2200],
                "privacy_level":           "PUBLIC_TO_EVERYONE",
                "disable_duet":            False,
                "disable_stitch":          False,
                "disable_comment":         False,
                "video_cover_timestamp_ms": 1000,
            },
            "source_info": {
                "source":            "FILE_UPLOAD",
                "video_size":        file_size,
                "chunk_size":        file_size,
                "total_chunk_count": 1,
            },
        },
        timeout=30,
    )
    init_resp.raise_for_status()
    data       = init_resp.json()["data"]
    publish_id = data["publish_id"]
    upload_url = data["upload_url"]
    print(f"[TikTok] アップロード初期化: publish_id={publish_id}")

    # Step 2: 動画アップロード
    with open(video_path, "rb") as f:
        upload_resp = requests.put(
            upload_url,
            headers={
                "Content-Type":   "video/mp4",
                "Content-Range":  f"bytes 0-{file_size - 1}/{file_size}",
                "Content-Length": str(file_size),
            },
            data=f,
            timeout=300,
        )
    upload_resp.raise_for_status()
    print("[TikTok] 動画アップロード完了")

    # Step 3: 投稿完了まで待機
    _wait_for_publish(publish_id, access_token)
    return {"publish_id": publish_id}


def _wait_for_publish(publish_id: str, access_token: str, max_wait: int = 300):
    for _ in range(max_wait // 10):
        time.sleep(10)
        resp = requests.post(
            "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type":  "application/json; charset=UTF-8",
            },
            json={"publish_id": publish_id},
            timeout=30,
        )
        resp.raise_for_status()
        status = resp.json()["data"]["status"]
        print(f"[TikTok] ステータス: {status}")
        if status == "PUBLISH_COMPLETE":
            print("[TikTok] 投稿完了")
            return
        if status in ("FAILED", "SPAM_RISK_TOO_MANY_POSTS", "SPAM_RISK_USER_BANNED_FROM_POSTING"):
            raise RuntimeError(f"TikTok: 投稿失敗 ({status})")
    raise TimeoutError("TikTok: 投稿処理がタイムアウトしました")


def main():
    parser = argparse.ArgumentParser(description="TikTok 自動投稿")
    parser.add_argument("video",    help="動画ファイルのパス（例: video.mp4）")
    parser.add_argument("template", help="テンプレート名（例: 復縁, 転職, ダイエット）")
    args = parser.parse_args()

    if not Path(args.video).exists():
        print(f"エラー: 動画ファイルが見つかりません: {args.video}")
        return

    caption = generate_from_template(args.template)
    print("=" * 50)
    print("生成されたキャプション:")
    print("=" * 50)
    print(caption)
    print("=" * 50)

    result = tiktok_post_video(args.video, caption)
    print(f"\n投稿成功: {result}")


if __name__ == "__main__":
    main()
