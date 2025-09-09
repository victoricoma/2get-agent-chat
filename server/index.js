require('dotenv/config');
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const {
  OPENAI_API_KEY,
  ASSISTANT_ID,
  NODE_ENV,
  CORS_ORIGINS,
  PORT = process.env.PORT || 8080,
} = process.env;

if (!OPENAI_API_KEY) {
  console.error('Falta OPENAI_API_KEY (defina nas variáveis do App Hosting).');
}
if (!ASSISTANT_ID) {
  console.error('Falta ASSISTANT_ID (asst_...).');
}

const app = express();

const allowList = (CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowList.length === 0 || allowList.includes(origin)) return cb(null, true);
    return cb(new Error('CORS bloqueado para esta origem: ' + origin));
  },
  credentials: false,
}));
app.use(express.json({ limit: '1mb' }));

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

app.get('/', (_req, res) => {
  res.status(200).json({ ok: true, service: '2get-agent-chat', env: NODE_ENV || 'prod', ts: Date.now() });
});
app.get('/health', (_req, res) => res.status(200).send('ok'));

async function waitForRun(threadId, runId) {
  if (!threadId || !runId) {
    throw new Error(`IDs inválidos: threadId=${threadId} runId=${runId}`);
  }
  if (!String(threadId).startsWith('thread_')) throw new Error(`threadId inválido: ${threadId}`);
  if (!String(runId).startsWith('run_')) throw new Error(`runId inválido: ${runId}`);

  while (true) {
    const run = await openai.beta.threads.runs.retrieve(threadId, runId);
    if (run.status === 'completed') return run;
    if (['failed', 'cancelled', 'expired'].includes(run.status)) {
      throw new Error(`Run ${runId} falhou: ${run.status}`);
    }
    await new Promise(r => setTimeout(r, 800));
  }
}

app.post('/api/chat', async (req, res) => {
  try {
    if (!OPENAI_API_KEY || !ASSISTANT_ID) {
      return res.status(500).json({ error: 'Backend sem credenciais (OPENAI_API_KEY/ASSISTANT_ID).' });
    }

    const { message, threadId } = req.body ?? {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message obrigatório (string).' });
    }


    const thread = threadId && String(threadId).startsWith('thread_')
      ? { id: threadId }
      : await openai.beta.threads.create();

    await openai.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: message,
    });

    const run = await openai.beta.threads.runs.create(thread.id, { assistant_id: ASSISTANT_ID });

    await waitForRun(thread.id, run.id);

    const list = await openai.beta.threads.messages.list(thread.id, { limit: 10 });
    const assistantMsg = list.data.find(m => m.role === 'assistant');

    let text = '';
    if (assistantMsg?.content?.length) {
      for (const c of assistantMsg.content) if (c.type === 'text') text += c.text.value;
    }

    return res.json({ threadId: thread.id, text });
  } catch (e) {
    console.error('Erro /api/chat:', e?.response?.data ?? e);
    return res.status(500).json({ error: e?.message || 'erro' });
  }
});
app.get('/api/threads/:threadId', async (req, res) => {
  try {
    const threadId = req.params.threadId;
    if (!threadId?.startsWith('thread_')) {
      return res.status(400).json({ error: `threadId inválido: ${threadId}` });
    }

    const { include = 'messages', limit = 20, before, after } = req.query;

    const thread = await openai.beta.threads.retrieve(threadId);

    let messages = undefined;
    if (String(include).split(',').map(s => s.trim()).includes('messages')) {
      const list = await openai.beta.threads.messages.list(threadId, {
        limit: Math.min(Number(limit) || 20, 100), 
        before, 
        after,
        order: 'desc',
      });

      messages = list.data.map(m => ({
        id: m.id,
        role: m.role,               
        created_at: m.created_at,  
        run_id: m.run_id || null,
        text: (m.content || [])
          .filter(c => c.type === 'text')
          .map(c => c.text.value)
          .join('\n')
      }));
    }

    return res.json({ thread, messages });
  } catch (e) {
    console.error('Erro GET /api/threads/:threadId:', e?.response?.data ?? e);
    return res.status(500).json({ error: e?.message || 'erro' });
  }
});
app.listen(PORT, () => {
  console.log(`API ouvindo em http://localhost:${PORT}`);
});

process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));
process.on('uncaughtException', (e) => console.error('uncaughtException:', e));
