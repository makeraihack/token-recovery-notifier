# フェーズA ステップ1: 技術検証結果

調査日: 2026-07-24
調査対象: `%USERPROFILE%\.claude\projects\**\*.jsonl`（実マシン上の実データ）

## 調査方法

Read/Glob/Grepツールで `C:\Users\chiko\.claude\projects` 配下の全jsonlファイル（メインセッション・`subagents\agent-*.jsonl` の両方）を横断検索し、
`"error":"rate_limit"` および `"isApiErrorMessage":true` を含む行、`resets` という語を含む行を抽出して実データを直接確認した。

## 発見1: セッション（5時間）レート制限の合成メッセージ（確認済み、PLAN.mdの内容と一致）

以下の形の行を、複数プロジェクト（SmallApp, ProcessGraph, News, Claude）・複数セッション・複数バージョン（`2.1.197`〜`2.1.217`）にわたって多数実データ確認した。

```json
{
  "type": "assistant",
  "message": {
    "model": "<synthetic>",
    "content": [{"type": "text", "text": "You've hit your session limit · resets 11pm (Etc/GMT-9)"}]
  },
  "error": "rate_limit",
  "isApiErrorMessage": true,
  "apiErrorStatus": 429,
  "version": "2.1.217"
}
```

観測された `resets` テキストのバリエーション（すべて `resets <時刻> (Etc/GMT-9)` 形式）:

- `resets 11pm (Etc/GMT-9)`
- `resets 12:30pm (Etc/GMT-9)`
- `resets 1:30pm (Etc/GMT-9)`
- `resets 2am (Etc/GMT-9)`
- `resets 12:10pm (Etc/GMT-9)`
- `resets 4:40am (Etc/GMT-9)`
- `resets 7:10pm (Etc/GMT-9)`
- `resets 1:20am (Etc/GMT-9)`
- `resets 3:30pm (Etc/GMT-9)` / `resets 4:30pm (Etc/GMT-9)` / `resets 5:10am (Etc/GMT-9)` / `resets 2:50pm (Etc/GMT-9)` / `resets 2pm (Etc/GMT-9)`

時・分ありなし両方のパターン（`H(am|pm)` と `H:MMam|pm` の両方）が実際に混在して出現することを確認した。タイムゾーンは今回の観測範囲内では常に `(Etc/GMT-9)`（このマシンのJST=UTC+9に対応）のみで、他のオフセット値の実例は確認できなかった。ただし `Etc/GMT-N` は符号反転のPOSIX慣習表記であるため、実装では `-9` に決め打ちせず、正規表現でオフセット整数を抽出し `-N` → `UTC+N` へ変換する汎用ロジックとする。

同一のレート制限イベントが、メインセッションのjsonlと同時刻に実行中だった `subagents/agent-*.jsonl` の両方に記録される実例も確認した（例: `48ba3a35-...jsonl` の275/276行目と、対応する `agent-a121a722136834582.jsonl` の33行目が同一の `resets 11pm (Etc/GMT-9)` を記録）。これは実装上、同一リセット時刻の通知を複数ファイルから重複検知してしまう可能性を意味し、スケジューラ側でリセット時刻ベースの重複排除が必要という設計判断の根拠になった。

## 発見2: 週次（weekly）レート制限の合成メッセージ → 未確認のまま

`weekly` / `week limit` を含む行も検索したが、ヒットしたのはいずれも「週次上限について調べたWeb検索結果のテキスト」や「アシスタントの説明文（地の文）」であり、`"error":"rate_limit"` かつ `"isApiErrorMessage":true` を伴う実際の合成メッセージとしての週次上限ヒットは1件も見つからなかった。

なお、あるアシスタントの発言（地の文）で `"You've hit your session limit · resets 4:40am JST"` という**セッション制限メッセージの言い換え**が見つかったが、これは実際の合成メッセージのコピーではなく、アシスタントが `(Etc/GMT-9)` を「JST」と平易な言葉に言い換えて説明した文章に過ぎない（実データの生ログでは常に `(Etc/GMT-9)` 表記だった）。これはむしろ「タイムゾーン表記のパースを決め打ちにしてはいけない」というPLAN.mdのリスク3を裏付ける傍証として扱う。

**結論: 週次レート制限の合成メッセージは、今回の調査でも実例を得られなかった。** PLAN.mdの記載通り「未確認のまま」とし、パーサーは以下の設計で両パターンに拡張しやすくした:

- レート制限メッセージ検知ロジック（`error === "rate_limit"` かつ `isApiErrorMessage === true` の行を検知）は、テキスト内容によらず共通。
- テキストから `resets <時刻> (Etc/GMT-N)` を抽出する正規表現と、テキストが「session」か「week」かの種別判定は分離した関数にした。
- 週次メッセージのテキストパターンが将来判明した際は、種別判定の正規表現を1箇所追加するだけで対応できる。
- 未知のフォーマット（`error`/`isApiErrorMessage` はあるが `resets ... (...)` にマッチしないテキスト等）を検知した場合はエラーにせず、警告ログを出して無視する防御的実装にした（PLAN.mdリスク1対応）。

## 発見3: タイムゾーンオフセット表記の汎用パース

`Etc/GMT-9` のような符号反転POSIX慣習表記を `-9 → +9` に決め打ちで変換するのではなく、`Etc/GMT([+-])(\d{1,2})` という正規表現でオフセット整数と符号を抽出し、符号を反転して実際のUTCオフセット分数に変換する汎用実装とした（`Etc/GMT+5` → UTC-5、`Etc/GMT-9` → UTC+9 等、両符号・任意の整数オフセットに対応）。実装は `src/parser/resetTimeParser.ts` の `parseEtcGmtOffsetMinutes()` を参照。

## 技術方針への反映

- パーサーは「メッセージ種別判定」「時刻文字列パース」「タイムゾーンオフセットパース」の3層に分離し、疎結合にした。
- フォーマット不一致時は例外を投げず警告ログのみに留める設計とした（`src/logger.ts` + 各parserのtry/catch）。
