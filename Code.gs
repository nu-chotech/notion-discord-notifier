/**
 * Notion ⇄ Discord 自動通知システム
 * （担当者表示 ＆ 完了タスク除外 ＆ 期限切れアラート対応版）
 */

// --- 1. Notionの更新チェック＆Discord通知（5分周期実行） ---
function checkNotionUpdates() {
  const properties = PropertiesService.getScriptProperties();
  const NOTION_API_KEY = properties.getProperty('NOTION_API_KEY');
  const DISCORD_WEBHOOK_URL = properties.getProperty('DISCORD_WEBHOOK_URL');
  
  const TASK_DB_ID = properties.getProperty('TASK_DB_ID');        // タスクDBのID
  const MINUTES_PAGE_ID = properties.getProperty('MINUTES_PAGE_ID'); // 議事録ページのID

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

  properties.setProperty('LAST_CHECK_TIME', now.toISOString());
}

// データベース（タスク）更新チェック関数
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
      const assignee = getTaskAssignee(page);
      sendDiscordTaskNotification(webhookUrl, type, title, assignee, page.url);
    });
  }
}

// 単一ページ（議事録）更新チェック関数
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
      sendDiscordSimpleNotification(webhookUrl, type, title, page.url);
    }
  }
}

// --- 2. 本日期限タスクのリマインド通知（朝実行：未完了のみ） ---
function checkTaskDeadlines() {
  const properties = PropertiesService.getScriptProperties();
  const NOTION_API_KEY = properties.getProperty('NOTION_API_KEY');
  const DISCORD_WEBHOOK_URL = properties.getProperty('DISCORD_WEBHOOK_URL');
  const TASK_DB_ID = properties.getProperty('TASK_DB_ID');

  if (!TASK_DB_ID) return;

  const today = new Date();
  const todayStr = Utilities.formatDate(today, "JST", "yyyy-MM-dd");

  const rawTasks = fetchTasksByFilter(TASK_DB_ID, NOTION_API_KEY, {
    property: "締切日",
    date: { equals: todayStr }
  }, "ascending");

  // 完了したタスクを除外
  const activeTasks = rawTasks.filter(page => !isTaskCompleted(page));

  if (activeTasks.length > 0) {
    let taskListText = "";
    activeTasks.forEach((page, index) => {
      const title = getPageTitle(page);
      const rawAssignee = getTaskAssignee(page);
      const mention = getDiscordMentions(rawAssignee);
      taskListText += `${index + 1}. **[${title}](${page.url})** 👤 担当: ${mention}\n`;
    });

    sendDiscordReminder(DISCORD_WEBHOOK_URL, todayStr, taskListText);
  } else {
    console.log("本日期限の未完了タスクはありませんでした。");
  }
}

// --- 3. 夜9時用：本日期限タスクの進捗・完了報告を促す通知（夜実行：未完了のみ） ---
function checkEveningTaskReport() {
  const properties = PropertiesService.getScriptProperties();
  const NOTION_API_KEY = properties.getProperty('NOTION_API_KEY');
  const DISCORD_WEBHOOK_URL = properties.getProperty('DISCORD_WEBHOOK_URL');
  const TASK_DB_ID = properties.getProperty('TASK_DB_ID');

  if (!TASK_DB_ID) return;

  const today = new Date();
  const todayStr = Utilities.formatDate(today, "JST", "yyyy-MM-dd");

  const rawTasks = fetchTasksByFilter(TASK_DB_ID, NOTION_API_KEY, {
    property: "締切日",
    date: { equals: todayStr }
  }, "ascending");

  // 完了したタスクを除外
  const activeTasks = rawTasks.filter(page => !isTaskCompleted(page));

  if (activeTasks.length > 0) {
    let taskListText = "本日締切のタスク一覧です。\n作業が完了した方、または現在の進捗について報告をお願いします！\n\n";
    
    activeTasks.forEach((page, index) => {
      const title = getPageTitle(page);
      const rawAssignee = getTaskAssignee(page);
      const mention = getDiscordMentions(rawAssignee);
      taskListText += `${index + 1}. **[${title}](${page.url})** 👤 担当: ${mention}\n`;
    });

    sendDiscordEveningReport(DISCORD_WEBHOOK_URL, todayStr, taskListText);
  } else {
    console.log("本日締切の未完了タスクはありませんでした。");
  }
}

// --- 4. 月曜朝用：今週締切 ＆ 期限切れタスク ---
function checkWeeklyTasks() {
  const properties = PropertiesService.getScriptProperties();
  const NOTION_API_KEY = properties.getProperty('NOTION_API_KEY');
  const DISCORD_WEBHOOK_URL = properties.getProperty('DISCORD_WEBHOOK_URL');
  const TASK_DB_ID = properties.getProperty('TASK_DB_ID');

  if (!TASK_DB_ID) return;

  const now = new Date();
  const mondayStr = Utilities.formatDate(now, "JST", "yyyy-MM-dd");
  const sunday = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000);
  const sundayStr = Utilities.formatDate(sunday, "JST", "yyyy-MM-dd");

  const pastLimit = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const pastLimitStr = Utilities.formatDate(pastLimit, "JST", "yyyy-MM-dd");

  // 1. 期限切れタスク
  const rawOverdue = fetchTasksByFilter(TASK_DB_ID, NOTION_API_KEY, {
    and: [
      { property: "締切日", date: { before: mondayStr } },
      { property: "締切日", date: { on_or_after: pastLimitStr } }
    ]
  }, "ascending");

  // 2. 今週締切タスク
  const rawWeekly = fetchTasksByFilter(TASK_DB_ID, NOTION_API_KEY, {
    and: [
      { property: "締切日", date: { on_or_after: mondayStr } },
      { property: "締切日", date: { on_or_before: sundayStr } }
    ]
  }, "ascending");

  const overdueTasks = rawOverdue.filter(page => !isTaskCompleted(page));
  const weeklyTasks = rawWeekly.filter(page => !isTaskCompleted(page));

  let descriptionText = "";
  const hasOverdue = overdueTasks && overdueTasks.length > 0;

  // 1. 期限切れセクション
  if (hasOverdue) {
    descriptionText += `### 期限切れ・未対応 (${overdueTasks.length}件)\n`;
    descriptionText += `> 期限が過ぎています。確認・進捗報告をお願いします！\n`;
    overdueTasks.forEach(page => {
      const title = getPageTitle(page);
      const rawAssignee = getTaskAssignee(page);
      const mention = getDiscordMentions(rawAssignee);
      const dueDate = getTaskDueDate(page);
      descriptionText += `• \`${dueDate}\` **[${title}](${page.url})** 👤 ${mention}\n`;
    });
    descriptionText += `\n`;
  }

  // 2. 今週締切セクション
  const startShort = mondayStr.slice(5).replace('-', '/');
  const endShort = sundayStr.slice(5).replace('-', '/');
  descriptionText += `### 今週の締切予定 (${startShort} 〜 ${endShort})\n`;
  
  if (weeklyTasks && weeklyTasks.length > 0) {
    weeklyTasks.forEach(page => {
      const title = getPageTitle(page);
      const rawAssignee = getTaskAssignee(page);
      const mention = getDiscordMentions(rawAssignee);
      const dueDate = getTaskDueDate(page);
      descriptionText += `• \`${dueDate}\` **[${title}](${page.url})** 👤 ${mention}\n`;
    });
  } else {
    descriptionText += `> 今週締め切りのタスクはありません \n`;
  }

  sendDiscordWeeklyNotification(DISCORD_WEBHOOK_URL, descriptionText, hasOverdue);
}

// --- 5. 毎週の継続・定期報告タスク通知（週1回実行） ---
const NOTION_PROP_CATEGORY = "選択";    // Notionで作成した「選択」プロパティの列名
const CATEGORY_WEEKLY_REPORT = "定期報告"; // 選択肢（タグ）の名前

function checkWeeklyProgressReport() {
  const properties = PropertiesService.getScriptProperties();
  const NOTION_API_KEY = properties.getProperty('NOTION_API_KEY');
  const DISCORD_WEBHOOK_URL = properties.getProperty('DISCORD_WEBHOOK_URL');
  const TASK_DB_ID = properties.getProperty('TASK_DB_ID');

  if (!TASK_DB_ID) return;

  // 「選択」プロパティで「定期報告」が選ばれているタスクを取得
  const rawTasks = fetchTasksByFilter(TASK_DB_ID, NOTION_API_KEY, {
    property: NOTION_PROP_CATEGORY,
    select: { equals: CATEGORY_WEEKLY_REPORT }
  }, "ascending");

  // 未完了の継続タスクのみを抽出
  const activeTasks = rawTasks.filter(page => !isTaskCompleted(page));

  if (activeTasks.length > 0) {
    const taskLines = [];
    activeTasks.forEach((page, index) => {
      const title = getPageTitle(page);
      const rawAssignee = getTaskAssignee(page);
      const mention = getDiscordMentions(rawAssignee);
      taskLines.push(`${index + 1}. **[${title}](${page.url})** 👤 担当: ${mention}`);
    });

    sendDiscordWeeklyReportRequest(DISCORD_WEBHOOK_URL, taskLines.join('\n'));
  } else {
    console.log("定期報告対象の未完了タスクはありませんでした。");
  }
}

// --- Notion ⇔ Discord マッピング表（サンプル） ---
// スクリプトプロパティ「DISCORD_USER_MAP」にJSON文字列として保存して取得する運用を推奨します。
const DISCORD_USER_MAP = JSON.parse(
  PropertiesService.getScriptProperties().getProperty('DISCORD_USER_MAP') || '{\n    "ユーザーA": "123456789012345678",\n    "ユーザーB": "876543210987654321"\n  }'
);

// 担当者文字列からDiscordメンション文字列を生成する関数
function getDiscordMentions(assigneeStr) {
  if (!assigneeStr || assigneeStr === '未設定') return '未設定';

  const names = assigneeStr.split(',').map(name => name.trim());
  const mentions = names.map(name => {
    const discordId = DISCORD_USER_MAP[name];
    return discordId ? `<@${discordId}>` : `\`${name}\``;
  });

  return mentions.join(' ');
}

// --- 共通ヘルパー関数 ---

// タスクが完了しているかどうかを判定する関数
function isTaskCompleted(page) {
  if (!page.properties) return false;
  
  const statusProp = page.properties["ステータス"] || page.properties["Status"];
  if (!statusProp) return false;

  if (statusProp.type === "status" && statusProp.status) {
    const name = statusProp.status.name;
    return name === "完了" || name === "Done" || name === "Complete";
  }
  if (statusProp.type === "select" && statusProp.select) {
    const name = statusProp.select.name;
    return name === "完了" || name === "Done" || name === "Complete";
  }
  if (statusProp.type === "checkbox") {
    return statusProp.checkbox === true;
  }
  return false;
}

// 汎用タスク検索
function fetchTasksByFilter(dbId, apiKey, filterPayload, sortDirection) {
  const url = `https://api.notion.com/v1/databases/${dbId}/query`;
  const payload = {
    filter: filterPayload,
    sorts: [{ property: "締切日", direction: sortDirection || "ascending" }],
    page_size: 50
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
  return data.results || [];
}

// ページタイトルの取得
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

// 担当者名の取得
function getTaskAssignee(page) {
  if (!page.properties) return '未設定';
  const props = page.properties;
  
  const candidateKeys = ['担当者', '担当', 'Assignee', 'Person', 'ユーザー'];
  let targetProp = null;
  for (const key of candidateKeys) {
    if (props[key]) {
      targetProp = props[key];
      break;
    }
  }
  if (!targetProp) {
    for (const key in props) {
      if (props[key].type === 'people') {
        targetProp = props[key];
        break;
      }
    }
  }
  if (!targetProp) return '未設定';

  if (targetProp.type === 'people' && targetProp.people && targetProp.people.length > 0) {
    return targetProp.people.map(p => p.name || '名前なし').join(', ');
  }
  if (targetProp.type === 'select' && targetProp.select) {
    return targetProp.select.name;
  }
  if (targetProp.type === 'multi_select' && targetProp.multi_select && targetProp.multi_select.length > 0) {
    return targetProp.multi_select.map(s => s.name).join(', ');
  }
  if (targetProp.type === 'rich_text' && targetProp.rich_text && targetProp.rich_text.length > 0) {
    return targetProp.rich_text[0].plain_text;
  }
  return '未設定';
}

// 締切日の整形（MM/DD 形式）
function getTaskDueDate(page) {
  if (page.properties && page.properties["締切日"] && page.properties["締切日"].date) {
    const rawDate = page.properties["締切日"].date.start.split('T')[0];
    return rawDate.slice(5).replace('-', '/');
  }
  return "日付なし";
}

// 送信関数群
function sendDiscordTaskNotification(webhookUrl, type, title, assignee, pageUrl) {
  const payload = {
    embeds: [{
      title: `【${type}】が更新されました`,
      description: `**[${title}](${pageUrl})**\n👤 担当: \`${assignee}\``,
      color: 0x5865F2,
      timestamp: new Date().toISOString()
    }]
  };
  sendToDiscord(webhookUrl, payload);
}

function sendDiscordSimpleNotification(webhookUrl, type, title, pageUrl) {
  const payload = {
    embeds: [{
      title: `【${type}】ページが更新されました`,
      description: `**[${title}](${pageUrl})**`,
      color: 0x5865F2,
      timestamp: new Date().toISOString()
    }]
  };
  sendToDiscord(webhookUrl, payload);
}

function sendDiscordReminder(webhookUrl, dateStr, taskListText, mentionContent = "") {
  const payload = {
    content: mentionContent,
    embeds: [{
      title: `【本日 (${dateStr}) 期限のタスク】`,
      description: taskListText,
      color: 0xED4245,
      timestamp: new Date().toISOString()
    }]
  };
  sendToDiscord(webhookUrl, payload);
}

function sendDiscordEveningReport(webhookUrl, dateStr, taskListText) {
  const payload = {
    embeds: [{
      title: `【本日 (${dateStr}) 締切タスク】進捗・完了報告のお願い`,
      description: taskListText,
      color: 0xF1C40F,
      timestamp: new Date().toISOString()
    }]
  };
  sendToDiscord(webhookUrl, payload);
}

function sendDiscordWeeklyNotification(webhookUrl, descriptionText, hasOverdue) {
  const payload = {
    embeds: [{
      title: hasOverdue ? "今週のタスク確認" : "今週のタスク一覧",
      description: descriptionText,
      color: hasOverdue ? 0xE67E22 : 0x3498DB,
      timestamp: new Date().toISOString()
    }]
  };
  sendToDiscord(webhookUrl, payload);
}

function sendDiscordWeeklyReportRequest(webhookUrl, taskListText) {
  const payload = {
    embeds: [{
      title: "継続・改善タスクの進捗報告",
      description: "今週もお疲れ様です！\n以下の継続・改善タスクについて、**今週行った取り組みや進捗・気づき**を報告してください！\n\n" + taskListText,
      color: 0x9B59B6,
      timestamp: new Date().toISOString()
    }]
  };
  sendToDiscord(webhookUrl, payload);
}

function sendToDiscord(webhookUrl, payload) {
  UrlFetchApp.fetch(webhookUrl, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}
