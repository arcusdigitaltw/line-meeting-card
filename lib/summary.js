/**
 * 會後摘要：把逐字稿丟給大型語言模型，拿回「重點、完整摘要、待辦事項」。
 * 走 OpenAI 相容格式（/v1/chat/completions），所以 OpenAI、OpenRouter、自架的 OneAPI／Ollama 都能接，
 * 只要改 LLM_BASE_URL、LLM_API_KEY、LLM_MODEL 三個環境變數。沒填 LLM_API_KEY 時此功能自動關閉。
 */
const BASE = (process.env.LLM_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '');
const KEY = process.env.LLM_API_KEY || '';
const MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
const enabled = () => !!KEY;

const mmss = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function transcriptText(segments) {
  let text = (segments || []).map(s => `[${mmss(s.start || 0)}] ${s.speaker || '與會者'}：${s.text}`).join('\n');
  if (text.length > 60000) text = `${text.slice(0, 60000)}\n\n（逐字稿過長，以上為前段內容）`;
  return text;
}

async function summarize(meeting) {
  const text = transcriptText(meeting.transcript);
  // 內容太少就不硬做，免得模型自己編一份會議紀錄出來
  if (text.replace(/\s+/g, '').length < 300) throw new Error('逐字稿內容太少（不到 300 字），無法產生摘要。可能是機器人太晚進場，或會議中幾乎沒有人說話。');

  const prompt = `你是專業的會議記錄。請只根據下面的逐字稿整理，逐字稿沒提到的事一律不要寫。
用繁體中文（台灣用語）。回傳 JSON，格式如下：
{
  "points": ["三到五條重點，每條一句話，講結論不要講過程"],
  "summary": "完整摘要，用 Markdown：每個議題一個 ## 標題，底下條列討論內容與決議；最後一段 ## 結論與共識",
  "action_items": [{"text": "要做的事", "assignee": "負責人姓名或 null", "due_date": "YYYY-MM-DD 或 null"}]
}

會議名稱：${meeting.title}

逐字稿：
${text}`;

  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, temperature: 0.3, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`語言模型回應 ${res.status}：${(await res.text()).slice(0, 200)}`);
  const content = ((await res.json()).choices?.[0]?.message?.content || '').replace(/^```(?:json)?\s*|\s*```$/g, '');
  let out; try { out = JSON.parse(content); } catch (e) { out = { points: [], summary: content, action_items: [] }; }
  return {
    summary_points: (Array.isArray(out.points) ? out.points : []).map(String).filter(Boolean).slice(0, 5),
    summary: String(out.summary || ''),
    action_items: (Array.isArray(out.action_items) ? out.action_items : []).slice(0, 30).map(a => ({
      text: String(a.text || '').trim(), assignee: a.assignee || null,
      due_date: /^\d{4}-\d{2}-\d{2}$/.test(a.due_date || '') ? a.due_date : null,
    })).filter(a => a.text),
  };
}

module.exports = { enabled, summarize, transcriptText };
