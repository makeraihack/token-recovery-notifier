# Token Recovery Notifier

Claude Code CLIの利用上限（セッション/週次のレート制限）がリセットされたタイミングを、Windowsのトースト通知（Action Center通知）で自動的に知らせる常駐アプリです。

## これは何をするアプリか

Claude Code CLIをWindows上で日常的に使っていて、レート制限に達すると、リセットされるまで手動でタイマーを設定したり、時々ターミナルを覗いて確認したりしていませんか。本アプリは、Claude Code CLIがローカルに書き出すセッションログ（`~/.claude/projects/**/*.jsonl`）を監視し、レート制限ヒットの記録を検知して、リセット予定時刻になったらWindowsのトースト通知でお知らせします。

- 複数プロジェクト（複数の作業フォルダ）でClaude Codeを使っていても横断的に検知します。
- タスクトレイに常駐し、Windows起動時に自動的に立ち上がります。
- 通知は完全にローカルで完結します。外部のプッシュ通知サービスや追加の認証情報は一切使用しません。

詳しい経緯・技術調査の内容は [`CONCEPT.md`](./CONCEPT.md) と [`PLAN.md`](./PLAN.md) / [`RESEARCH.md`](./RESEARCH.md) を参照してください。

## 動作要件

- **OS**: Windows 10 / 11（Windows専用です。macOS/Linuxには対応していません）
- **Node.js**: 20系以降（ソースから実行する場合。開発・動作確認は v24 系で行っています）
- **PowerShell**: 5.1以降（Windows標準搭載のもので動作します。追加インストール不要）
- **Claude Code CLI**: `~/.claude/projects/**/*.jsonl` にセッションログを書き出すバージョン（現行の一般的なインストールであれば問題ありません）

## インストール / セットアップ

### 方法A: ポータブル版（Node.jsのインストールが不要）

1. [Releases](#配布形式について) からポータブルzip（`token-recovery-notifier-portable-win-x64-vX.Y.Z.zip`）をダウンロードして、任意のフォルダへ展開します。
2. 展開したフォルダ内の `TokenRecoveryNotifier.cmd` をダブルクリックして起動します。

    > ポータブル版には実行に必要なNode.jsランタイム一式は含まれていません。**Node.js 20系以降がインストール済みであること**が前提です（[nodejs.org](https://nodejs.org/) からインストールできます）。単一の自己完結型exeではない点はご了承ください（理由は本READMEの「配布形式について」を参照）。

### 方法B: ソースから実行

```powershell
git clone <このリポジトリのURL>
cd token-recovery-notifier
npm install
npm run build
npm start
```

開発中に直接TypeScriptを実行したい場合は `npm run dev` も使えます（`tsx`でトランスパイルなしに実行）。

## 使い方

- 起動すると、タスクトレイにアイコンが表示されます（見えない場合は「隠れているインジケーターを表示する」から確認してください）。
- 起動時にWindowsのスタートアップ登録（`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`）を自動的に行うため、次回以降はWindowsにサインインすると自動的に立ち上がります。
- Claude Code CLIでレート制限に達すると、バックグラウンドで検知し、リセット予定時刻にWindowsのトースト通知が届きます。
- アプリを起動した時点で既にレート制限中だった場合（PCから離れていた場合など）も、リセットがまだ先であれば起動時に検知して通知を予約します。
- **終了する**には、タスクトレイアイコンを右クリックし、メニューから「終了」を選んでください。
- ログは `%USERPROFILE%\.token-recovery-notifier\app.log` に出力されます。動作がおかしいと感じたときはまずこちらを確認してください。

## Slack通知の設定方法（任意）

Windowsのトースト通知に加えて、Slackにも同時に通知したい場合は以下の手順で設定できます。設定しない場合は、これまで通りWindows Toast通知のみが動作します（エラーにはなりません）。

1. Slackのワークスペースで **Incoming Webhook** を作成し、Webhook URL（`https://hooks.slack.com/services/...`）を取得します。手順はSlack公式ドキュメント（[Incoming Webhooksを使用する](https://api.slack.com/messaging/webhooks)）を参照してください。
2. `%USERPROFILE%\.token-recovery-notifier\config.json` を作成し、以下の形式で取得したWebhook URLを記述します（`.token-recovery-notifier` フォルダが存在しない場合は作成してください）。

    ```json
    {
      "slackWebhookUrl": "https://hooks.slack.com/services/xxxxx/xxxxx/xxxxxxxxxxxxxxxxxxxxxxxx"
    }
    ```

3. アプリを再起動すると設定が反映されます。以降、レート制限がリセットされたタイミングでWindows ToastとSlackの両方に通知が届きます。

`config.json` が存在しない場合や `slackWebhookUrl` が未設定・空の場合は、Slack通知は行われず、代わりに起動時にログへその旨の案内が一度だけ出力されます（アプリ自体はエラーにならず、Windows Toast通知のみで動作を続けます）。

## 既知の制約・注意事項（正直な開示）

- **非公式の内部ファイル形式に依存しています。** Claude Code CLIが `~/.claude/projects/**/*.jsonl` に書き出すセッションログの内容・文言は、Anthropicが公式にサポートするAPIではなく、CLIの内部実装です。CLIのバージョンアップでフォーマットが変わると、検知が正しく動作しなくなる可能性があります（フォーマット不一致を検知した場合はログに警告を出す設計にしていますが、検知自体が完全に止まってしまう可能性はあります）。
- **週次（weekly）レート制限のメッセージ形式は未検証です。** セッション（5時間）のレート制限については実データで確認済みですが、週次レート制限の合成メッセージは実例を得られていません（詳細は [`RESEARCH.md`](./RESEARCH.md)）。週次上限のみに達した場合、通知が正しく機能しない可能性があります。
- **タイムゾーン表記は `Etc/GMT±N` 形式を前提にしています。** これまで観測できた実データはすべてこの形式でしたが、他の表記が使われた場合は警告ログを出して無視します（決め打ちで誤った時刻を通知しないための安全側の設計です）。
- 通知は「リセットされたお知らせ」のみを行います。レート制限解除後にプロンプトを自動送信するような「自動再開」機能はありません（意図的なスコープ外です）。
- 複数のClaude Codeアカウントを同時に扱うマルチアカウント対応は現時点では未対応です。

## 配布形式について

Windows向けの配布形式として、**ビルド済みJS + 本番用`node_modules` + 起動用`.cmd`をまとめたポータブルzip**を採用しています。

単一の自己完結型exe化（`pkg`/`@yao-pkg/pkg`等でNode.jsランタイムごと1つのexeに固める方式）も検討しましたが、Windowsトースト通知に使用している`node-notifier`は内部で`snoretoast-x64.exe`という同梱の実行可能ファイルを外部プロセスとして起動する仕組みになっており、これをpkg等の仮想スナップショットファイルシステム上に配置した場合、実プロセスとして正しく起動できない相性リスクがあります。今回はOSS公開の初期段階でもあるため、動作の確実性・検証のしやすさを優先し、実ファイルとして`node_modules`をそのまま同梱するポータブルzip方式を選びました（自己完結型exe化は将来の改善候補です）。

## ライセンス

[MIT License](./LICENSE) の下で公開しています。改変・商用利用を問わず自由にご利用いただけます。

## サポート・投げ銭

気に入っていただけたら、[GitHub Sponsors](https://github.com/sponsors/makeraihack) で応援していただけると励みになります（note記事公開時にはそちらにも投げ銭リンクを追加予定です）。
