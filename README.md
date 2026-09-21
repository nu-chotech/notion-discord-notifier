# notion-discord-notifier
# Notion ⇄ Discord 自動通知システム (GAS連携)

Google Apps Script (GAS) を利用して、Notion上の**議事録更新**、**タスクの追加・更新**、**本日期限タスクのリマインド/進捗確認**、**今週のタスク＆期限切れアラート**、**定期報告タスクの自動催促**をDiscordへ完全自動通知するシステムです。

外部の有料サービスを使用せず、すべて無料で永続運用できます。

---

## 主な機能

### 1. Notion更新自動通知（5分周期）
* **議事録（単一ページ形式）**: 指定した議事録ページが更新された際、タイトルとリンクをDiscordに自動通知します。
* **タスク（データベース形式）**: タスクデータベースで追加・変更があった際、タスク名・担当者・直リンクを通知します。

### 2. 本日期限タスクのリマインド（朝・夜の2回）
* **朝のリマインド（毎朝）**: 本日締切の未完了タスクを一覧表示し、担当者へDiscordメンション付きで注意喚起します。
* **夜の進捗・完了報告の催促（毎夜）**: 本日締切の未完了タスクに対して、作業完了報告または進捗報告を促します。

### 3. 今週のタスク ＆ 期限切れアラート（月曜朝）
* **期限切れタスク**: 過去30日以内の未完了・期限切れタスクを警告表示します。
* **今週の予定**: 今週（月〜日）に締切を迎えるタスクを一覧で可視化します。

### 4. 継続・定期報告タスクの進捗催促（週1回）
* Notion上で「定期報告」タグ（カテゴリ）がついた未完了タスクを抽出し、週間の振り返りや進捗共有を自動促します。

---

## システム構成・必要なもの

* **Notion**: アカウント ＆ コネクト（内部インテグレーション）
* **Discord**: サーバー ＆ チャンネル用 Webhook URL
* **Google Apps Script (GAS)**: 無料Googleアカウント

---

## セットアップ手順

### Step 1: Notion側の設定
1. [Notion インテグレーション管理画面](https://www.notion.com/my-integrations) にアクセスし、「＋ 新規コネクト」を作成します。
   * タイプ: **インテグレーション**
   * 名前: 任意（例: `Discord連携`）
2. 発行された **アクセストークン（`ntn_...` または `secret_...`）** をコピーします。
3. 対象の **「タスクデータベース」** および **「議事録ページ」** をNotion上で開き、画面右上の `...` ＞ `接続（Connections）` から作成したコネクトを追加します。
4. それぞれのページURLから **32桁のID（英数字のみ）** を抽出します。
   * タスクDB ID例: `https://www.notion.so/workspace/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx?v=...` ➔ `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
   * 議事録ページ ID例: `https://www.notion.so/workspace/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` ➔ `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

---

### Step 2: Discord側の設定
1. 通知を送りたいDiscordチャンネルの `チャンネルの編集（歯車マーク）` を開きます。
2. `連携サービス` ＞ `ウェブフック` ＞ `新しいウェブフック` を作成し、**ウェブフック URL** をコピーします。

---

### Step 3: GAS（Google Apps Script）の設定
1. [Google Apps Script](https://script.google.com/) で新規プロジェクトを作成します。
2. 画面左側の ⚙ **プロジェクトの設定** を開き、ページ下部の **スクリプト プロパティ** に以下の値を登録します。

| プロパティ名 | 設定する値（概要） |
| :--- | :--- |
| `NOTION_API_KEY` | Notionの内部インテグレーション APIキー |
| `TASK_DB_ID` | タスクデータベースの32桁ID |
| `MINUTES_PAGE_ID` | 議事録ページの32桁ID |
| `DISCORD_WEBHOOK_URL` | DiscordのWebhook URL |
| `DISCORD_USER_MAP` | Notion担当者名とDiscord IDのマッピング (JSON形式) |

#### 💡 `DISCORD_USER_MAP` の設定例
Notion上の担当者名（文字列）をDiscordのIDに紐付けることで、自動で `<@ID>` メンションに変換されます。

```json
{
  "山田太郎": "123456789012345678",
  "佐藤花子": "876543210987654321"
}
