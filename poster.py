#!/usr/bin/env python3
"""
Instagram Reels & TikTok 自動投稿ツール
"""

import os
import time
import argparse
import requests
from pathlib import Path
from caption_generator import generate_from_template, generate_caption, CaptionInput


# ── Instagram (Meta Graph API) ─────────────────────────────────────────────────

def instagram_post_reel(video_path: str, caption: str) -> dict:
    """Instagram Reels に動画を投稿する"""
    access_token = os.environ["INSTAGRAM_ACCESS_TOKEN"]
    ig_user_id   = os.environ["INSTAGRAM_USER_ID"]
    base = f"https://graph.facebook.com/v21.0/{ig_user_id}"

    # Step 1: コンテナ作成（動画URLが必要なため、まずアップロードURLを取得）
    video_url = _upload_video_to_instagram(video_path, access_token, ig_user_id)

    create_resp = requests.post(
        f"{base}/media",
        data={
            "media_type": "REELS",
            "video_url":  video_url,
            "caption":    caption,
            "access_token": access_token,
        },
        timeout=60,
    )
    create_resp.raise_for_status()
    container_id = create_resp.json()["id"]
    print(f"[Instagram] コンテナ作成: {container_id}")

    # Step 2: 動画処理が完了するまで待機
    _wait_for_instagram_container(container_id, access_token)

    # Step 3: 公開
    publish_resp = requests.post(
        f"{base}/media_publish",
        data={"creation_id": container_id, "access_token": access_token},
        timeout=30,
    )
    publish_resp.raise_for_status()
    media_id = publish_resp.json()["id"]
    print(f"[Instagram] 投稿完了: media_id={media_id}")
    return {"platform": "instagram", "media_id": media_id}


def _upload_video_to_instagram(video_path: str, access_token: str, ig_user_id: str) -> str:
    """
    動画をInstagramのアップロードセッションに送り、公開URLを返す。
    Meta の Resumable Upload API を使用。
    """
    file_size = Path(video_path).stat().st_size

    # アップロードセッション開始
    session_resp = requests.post(
        "https://graph.facebook.com/v21.0/app/uploads",
        data={
            "file_length": file_size,
            "file_type":   "video/mp4",
            "access_token": access_token,
        },
        timeout=30,
    )
    session_resp.raise_for_status()
    upload_session_id = session_resp.json()["id"]

    # 動画バイナリを転送
    with open(video_path, "rb") as f:
        upload_resp = requests.post(
            f"https://graph.facebook.com/v21.0/{upload_session_id}",
            headers={
                "Authorization":       f"OAuth {access_token}",
                "file_offset":         "0",
                "Content-Type":        "application/octet-stream",
            },
            data=f,
            timeout=300,
        )
    upload_resp.raise_for_status()
    return upload_resp.json()["h"]  # ハンドル（video_url として使用）


def _wait_for_instagram_container(container_id: str, access_token: str, max_wait: int = 300):
    """コンテナの処理完了を最大 max_wait 秒待つ"""
    for _ in range(max_wait // 10):
        time.sleep(10)
        status_resp = requests.get(
            f"https://graph.facebook.com/v21.0/{container_id}",
            params={"fields": "status_code", "access_token": access_token},
            timeout=30,
        )
        status_resp.raise_for_status()
        status = status_resp.json().get("status_code")
        print(f"[Instagram] 処理ステータス: {status}")
        if status == "FINISHED":
            return
        if status == "ERROR":
            raise RuntimeError("Instagram: 動画処理中にエラーが発生しました")
    raise TimeoutError("Instagram: 動画処理がタイムアウトしました")


# ── TikTok (Content Posting API) ──────────────────────────────────────────────

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
                "title":          caption[:2200],  # TikTokの上限
                "privacy_level":  "PUBLIC_TO_EVERYONE",
                "disable_duet":   False,
                "disable_stitch": False,
                "disable_comment": False,
                "video_cover_timestamp_ms": 1000,
            },
            "source_info": {
                "source":         "FILE_UPLOAD",
                "video_size":     file_size,
                "chunk_size":     file_size,
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
                "Content-Type":           "video/mp4",
                "Content-Range":          f"bytes 0-{file_size - 1}/{file_size}",
                "Content-Length":         str(file_size),
            },
            data=f,
            timeout=300,
        )
    upload_resp.raise_for_status()
    print(f"[TikTok] 動画アップロード完了")

    # Step 3: 投稿ステータス確認
    _wait_for_tiktok_publish(publish_id, access_token)
    return {"platform": "tiktok", "publish_id": publish_id}


def _wait_for_tiktok_publish(publish_id: str, access_token: str, max_wait: int = 300):
    """TikTok の投稿完了を最大 max_wait 秒待つ"""
    for _ in range(max_wait // 10):
        time.sleep(10)
        status_resp = requests.post(
            "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type":  "application/json; charset=UTF-8",
            },
            json={"publish_id": publish_id},
            timeout=30,
        )
        status_resp.raise_for_status()
        status = status_resp.json()["data"]["status"]
        print(f"[TikTok] 投稿ステータス: {status}")
        if status == "PUBLISH_COMPLETE":
            print("[TikTok] 投稿完了")
            return
        if status in ("FAILED", "SPAM_RISK_TOO_MANY_POSTS", "SPAM_RISK_USER_BANNED_FROM_POSTING"):
            raise RuntimeError(f"TikTok: 投稿失敗 ({status})")
    raise TimeoutError("TikTok: 投稿処理がタイムアウトしました")


# ── メイン ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Instagram & TikTok 自動投稿")
    parser.add_argument("video",    help="動画ファイルのパス（例: video.mp4）")
    parser.add_argument("template", help=f"テンプレート名（例: 復縁, 転職, ダイエット）")
    parser.add_argument(
        "--platform", choices=["instagram", "tiktok", "both"], default="both",
        help="投稿先（デフォルト: both）",
    )
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

    results = []
    if args.platform in ("instagram", "both"):
        results.append(instagram_post_reel(args.video, caption))
    if args.platform in ("tiktok", "both"):
        results.append(tiktok_post_video(args.video, caption))

    print("\n投稿結果:")
    for r in results:
        print(f"  {r['platform']}: 成功 {r}")


if __name__ == "__main__":
    main()
