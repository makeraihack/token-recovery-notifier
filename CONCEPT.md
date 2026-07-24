# Claudeのトークン回復通知アプリ

## コンセプト
Claude Codeの使用量上限（5時間/週次などのレート制限）がリセットされ、再び使えるようになったタイミングをOS通知で知らせるアプリ。

## スコープ（初期）
- Claude Codeの使用量上限の状態を検知する
- 上限がリセットされたタイミングでOS通知を出す

## スコープ外（初期は含めない）
- Anthropic APIの利用量・残高監視（別ユースケースのため対象外）

## 未決事項
- 使用量上限の状態をどこから取得するか（Claude Code CLI/設定ファイル/API等）は要調査

## 方向性（確定）
- **Claude特化**: SessionWatcherのようなマルチツール対応はせず、Claude Codeに絞る（開発スコープを小さくし、価格を下げる根拠にする）
- **価格モデル**: 無料＋投げ銭（ドネーション）。コア機能（使用量上限リセットのOS通知）は完全無料で広く使ってもらい、GitHub Sponsors等への投げ銭導線を設置する。有料の機能制限は設けない。

## 競合調査（2026-07-21時点）

| 名前 | 価格モデル | 強み | 弱み |
|---|---|---|---|
| Usagebar (macOS) | 実質無料（寄付制） | 閾値通知、リセットタイマー | macOS専用 |
| SessionWatcher (macOS) | $6.99買い切り〜Pro $59/$24年 | Claude Code/Codex/Cursor横断対応、唯一の本格収益化例 | macOS専用 |
| ClaudeUsageBar/ClaudeBar (macOS, OSS) | 完全無料 | シンプル、複数AI対応版あり | 収益化なし、通知弱い |
| ClaudeKit (Chrome拡張) | 基本無料 | リセットカウントダウン、通知 | claude.ai Web版チャット専用、Claude Code CLIは非対応 |
| usage-monitor-for-claude / claudeusagewin (Windowsトレイ, OSS) | 完全無料 | Windowsネイティブ | 個人OSS、UI/サポート薄い、収益化ゼロ |
| unsnooze / code-notify / claude-reset 等 (CLI, OSS) | 完全無料 | 自動再開機能 | GUIなし、開発者以外には不向き |

**市場の隙間**: 競合自体は既に4系統（macOS/Windows/Chrome拡張/CLI）存在するが、**収益化しているのはSessionWatcher(macOS)のみ**。Windows市場は個人OSS無料アプリのみでUI/サポートが手薄。「リセット通知」単機能に絞った軽量アプリも少ない。マルチアカウント/マルチツール横断監視への課金需要はSessionWatcher Proで実証済み。

**推奨する参入戦略**:
1. Windows特化・無料+アドオン: Windows Toast通知に特化した軽量常駐アプリ。基本無料、広告は補助収益（控えめなスポンサー枠）。
2. （本命）マルチアカウント/マルチツール対応の有料サブスク: 基本のOS通知（単一アカウント）は無料開放、複数アカウント一括監視・Slack/Discord通知・チーム共有を月額$2.99〜4.99で提供。フリーランス/小規模チームを転換対象にする。

## 関連カード
- processgraph: ludqoze（Claudeのトークン回復通知アプリ）
