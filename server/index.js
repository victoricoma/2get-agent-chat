require('dotenv/config');
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

const { OPENAI_API_KEY, ASSISTANT_ID, PORT = 8787 } = process.env;

// Sane check: não sobe sem chave
if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY ausente. Configure em server/.env');
  process.exit(1);
}
if (!ASSISTANT_ID) {
  console.error('ASSISTANT_ID ausente. Copie do Playground (asst_...)');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

console.log(`OpenAI key iniciada: ${OPENAI_API_KEY.slice(0, 6)}•••`);

async function waitForRun(threadId, runId) {
  if (!threadId || !runId) {
    throw new Error(`IDs inválidos: threadId=${threadId} runId=${runId}`);
  }
  if (!String(threadId).startsWith('thread_')) {
    throw new Error(`threadId não parece uma thread: ${threadId}`);
  }
  if (!String(runId).startsWith('run_')) {
    throw new Error(`runId não parece um run: ${runId}`);
  }

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
    const { message, threadId: incomingThreadId } = req.body ?? {};
    if (!message) return res.status(400).json({ error: 'message obrigatório' });

    console.log('BODY:', req.body);

    // 1) decidir thread
    let thread;
    if (incomingThreadId && String(incomingThreadId).startsWith('thread_')) {
      thread = { id: incomingThreadId };
      console.log('Reusando thread existente:', thread.id);
    } else {
      thread = await openai.beta.threads.create();
      console.log('Criada nova thread:', thread.id);
    }

    if (!thread?.id || !String(thread.id).startsWith('thread_')) {
      throw new Error(`thread.id inválido: ${thread?.id}`);
    }

    // 2) mensagem do usuário
    await openai.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: message,
    });

    // 3) criar run
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.ASSISTANT_ID,
    });

    console.log('Run criado:', run?.id);
    if (!run?.id || !String(run.id).startsWith('run_')) {
      throw new Error(`run.id inválido: ${run?.id}`);
    }

    // 4) aguardar terminar
    await waitForRun(thread.id, run.id);

    // 5) coletar resposta
    const list = await openai.beta.threads.messages.list(thread.id, { limit: 10 });
    const assistantMsg = list.data.find(m => m.role === 'assistant');

    let text = '';
    if (assistantMsg?.content?.length) {
      for (const c of assistantMsg.content) if (c.type === 'text') text += c.text.value;
    }

    return res.json({ threadId: thread.id, text });
  } catch (e) {
    console.error('Erro /api/chat:', e?.response?.data ?? e);
    return res.status(500).json({ error: String(e.message || e) });
  }
});

async function waitForRun(threadId, runId) {
  console.log('waitForRun -> threadId:', threadId, '| runId:', runId);

  if (!threadId || !runId) {
    throw new Error(`IDs inválidos: threadId=${threadId} runId=${runId}`);
  }
  if (!String(threadId).startsWith('thread_')) {
    throw new Error(`threadId não parece uma thread: ${threadId}`);
  }
  if (!String(runId).startsWith('run_')) {
    throw new Error(`runId não parece um run: ${runId}`);
  }

  while (true) {
    const run = await openai.beta.threads.runs.retrieve(threadId, runId);
    if (run.status === 'completed') return run;
    if (['failed', 'cancelled', 'expired'].includes(run.status)) {
      throw new Error(`Run ${runId} falhou: ${run.status}`);
    }
    await new Promise(r => setTimeout(r, 800));
  }
}

