// --- 【機能①】Notionの更新をチェックしてDiscordに通知する ---
function checkNotionUpdates() {
  const properties = PropertiesService.getScriptProperties();
  const NOTION_API_KEY = properties.getProperty('NOTION_API_KEY');
  const DISCORD_WEBHOOK_URL = properties.getProperty('DISCORD_WEBHOOK_URL');
  
  const TASK_DB_ID = properties.getProperty('TASK_DB_ID');          // タスクDBのID
  const MINUTES_PAGE_ID = properties.getProperty('MINUTES_DB_ID'); // 議事録ページのID

  // 前回チェック時刻の取得（初回は過去10分前）
  const lastCheck = properties.getProperty('LAST_CHECK_TIME');
  const now = new Date();
  const checkTime = lastCheck ? new Date(lastCheck) : new Date(now.getTime() - 10 * 60 * 1000);

  // 1. タスク（データベース形式）の更新チェック
  if (TASK_DB_ID) {
    checkDatabaseUpdates(TASK_DB_ID, 'タスク', checkTime, NOTION_API_KEY, DISCORD_WEBHOOK_URL);
  }

  // 2. 議事録（単一ページ内のテキスト更新）のチェック
  if (MINUTES_PAGE_ID) {
    checkSinglePageUpdate(MINUTES_PAGE_ID, '議事録', checkTime, NOTION_API_KEY, DISCORD_WEBHOOK_URL);
  }

  // 今回のチェック時刻を保存
  properties.setProperty('LAST_CHECK_TIME', now.toISOString());
}

// データベース用チェック関数
function checkDatabaseUpdates(dbId, type, checkTime, apiKey, webhookUrl) {
  const url = `https://api.notion.com/v1/databases/${dbId}/query`;
  const payload = {
    filter: {
      timestamp: "last_edited_time",
      last_edited_time: { after: checkTime.toISOString() }
    }
  };

  const options = {
    method: "post",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const data = JSON.parse(response.getContentText());

  if (data.results && data.results.length > 0) {
    data.results.forEach(page => {
      const title = getPageTitle(page);
      sendDiscordNotification(webhookUrl, type, title, page.url);
    });
  }
}

// 単一ページ（議事録ページ自体）の更新チェック関数
function checkSinglePageUpdate(pageId, type, checkTime, apiKey, webhookUrl) {
  const url = `https://api.notion.com/v1/pages/${pageId}`;
  const options = {
    method: "get",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Notion-Version": "2022-06-28"
    },
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const page = JSON.parse(response.getContentText());

  if (page && page.last_edited_time) {
    const lastEdited = new Date(page.last_edited_time);
    if (lastEdited > checkTime) {
      const title = getPageTitle(page);
      sendDiscordNotification(webhookUrl, type, title, page.url);
    }
  }
}

// ページタイトルの取得用ヘルパー関数
function getPageTitle(page) {
  if (!page.properties) return 'タイトルなし';
  const props = page.properties;
  for (const key in props) {
    if (props[key].type === 'title' && props[key].title && props[key].title.length > 0) {
      return props[key].title[0].plain_text;
    }
  }
  return 'タイトルなし';
}

// Discord Webhook送信関数
function sendDiscordNotification(webhookUrl, type, title, pageUrl) {
  const payload = {
    embeds: [{
      title: `【${type}】ページが更新されました`,
      description: `**[${title}](${pageUrl})**`,
      color: 0x5865F2,
      timestamp: new Date().toISOString()
    }]
  };

  UrlFetchApp.fetch(webhookUrl, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  });
}

// --- 【議事録テスト用】ページの更新チェックテスト ---
function testSinglePageNotification() {
  const properties = PropertiesService.getScriptProperties();
  const NOTION_API_KEY = properties.getProperty('NOTION_API_KEY');
  const DISCORD_WEBHOOK_URL = properties.getProperty('DISCORD_WEBHOOK_URL');
  const MINUTES_PAGE_ID = properties.getProperty('MINUTES_DB_ID');

  const url = `https://api.notion.com/v1/pages/${MINUTES_PAGE_ID}`;
  const options = {
    method: "get",
    headers: {
      "Authorization": `Bearer ${NOTION_API_KEY}`,
      "Notion-Version": "2022-06-28"
    },
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const page = JSON.parse(response.getContentText());

  if (page && page.last_edited_time) {
    const title = getPageTitle(page);
    console.log(`ページタイトル取得成功: [${title}]`);
    sendDiscordNotification(DISCORD_WEBHOOK_URL, "議事録テスト", title, page.url);
    console.log("Discordへ送信完了！");
  } else {
    console.log("ページの取得に失敗しました。");
  }
}

// --- 【機能②】今日が期限のタスクを自動でDiscordにリマインド通知する ---
function checkTaskDeadlines() {
  const properties = PropertiesService.getScriptProperties();
  const NOTION_API_KEY = properties.getProperty('NOTION_API_KEY');
  const DISCORD_WEBHOOK_URL = properties.getProperty('DISCORD_WEBHOOK_URL');
  const TASK_DB_ID = properties.getProperty('TASK_DB_ID');

  if (!TASK_DB_ID) return;

  // 日本時間で今日の日付（YYYY-MM-DD）を取得
  const today = new Date();
  const todayStr = Utilities.formatDate(today, "JST", "yyyy-MM-dd");

  const url = `https://api.notion.com/v1/databases/${TASK_DB_ID}/query`;
  
  // Notionの「期限」プロパティが今日の日付のものを検索
  const payload = {
    filter: {
      property: "期限", // ※NotionのタスクDBの期限プロパティ名に合わせて変更（例: "日付" や "Due Date" など）
      date: {
        equals: todayStr
      }
    }
  };

  const options = {
    method: "post",
    headers: {
      "Authorization": `Bearer ${NOTION_API_KEY}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const data = JSON.parse(response.getContentText());

  if (data.results && data.results.length > 0) {
    let taskListText = "";
    data.results.forEach((page, index) => {
      const title = getPageTitle(page);
      taskListText += `${index + 1}. **[${title}](${page.url})**\n`;
    });

    // Discordへリマインド通知を送信
    sendDiscordReminder(DISCORD_WEBHOOK_URL, todayStr, taskListText);
  } else {
    console.log("本日期限のタスクはありませんでした。");
  }
}

// 期限リマインド用のDiscord送信関数
function sendDiscordReminder(webhookUrl, dateStr, taskListText) {
  const payload = {
    embeds: [{
      title: `【本日 (${dateStr}) 期限のタスク】`,
      description: taskListText,
      color: 0xED4245, // 赤色
      timestamp: new Date().toISOString()
    }]
  };

  UrlFetchApp.fetch(webhookUrl, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  });
}

// --- 【機能③】Discordからのタスク確認（Slash Command対応） ---
function doPost(e) {
  try {
    const json = JSON.parse(e.postData.contents);

    // 1. DiscordからのPing（初回接続検証）に対する応答
    if (json.type === 1) {
      return ContentService.createTextOutput(JSON.stringify({ type: 1 }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 2. スラッシュコマンド実行時の処理
    if (json.type === 2) {
      const taskListText = getActiveTasksText();
      return ContentService.createTextOutput(JSON.stringify({
        type: 4, // メッセージ返信
        data: {
          content: taskListText
        }
      })).setMimeType(ContentService.MimeType.JSON);
    }
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      type: 4,
      data: { content: "エラーが発生しました: " + error.toString() }
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Notionからタスク一覧を取得してテキスト整形する関数
function getActiveTasksText() {
  const properties = PropertiesService.getScriptProperties();
  const NOTION_API_KEY = properties.getProperty('NOTION_API_KEY');
  const TASK_DB_ID = properties.getProperty('TASK_DB_ID');

  if (!TASK_DB_ID) return "タスクデータベースIDが設定されていません。";

  const url = `https://api.notion.com/v1/databases/${TASK_DB_ID}/query`;
  const payload = { page_size: 10 };

  const options = {
    method: "post",
    headers: {
      "Authorization": `Bearer ${NOTION_API_KEY}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const data = JSON.parse(response.getContentText());

  if (!data.results || data.results.length === 0) {
    return "現在、登録されているタスクはありません。";
  }

  let text = "**【Notion タスク一覧】**\n";
  data.results.forEach((page, index) => {
    const title = getPageTitle(page);
    text += `${index + 1}. **[${title}](${page.url})**\n`;
  });

  return text;
}
