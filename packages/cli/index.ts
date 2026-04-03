import '@swipe-to-hire/agent/env';
import { env } from '@swipe-to-hire/agent/env';
import { buildGraph } from '@swipe-to-hire/agent/graph';
import { getSentJobIds, saveJobs } from '@swipe-to-hire/agent/db';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';

// USER_ID = your Telegram user ID. Set in .env or CLI_ARG.
// This lets you run the actual graph (with your DB record) without the Telegram bot.
const telegramUserId = env.USER_ID;
if (!telegramUserId) {
  console.error('❌ USER_ID is not set in .env — add it to run the graph as yourself');
  process.exit(1);
}
const userId: number = telegramUserId;

class ToolCallLogger extends BaseCallbackHandler {
  name = 'ToolCallLogger';

  override handleToolStart(_tool: any, input: string) {
    const toolName = _tool?.name ?? _tool?.id?.[3] ?? 'tool';
    try {
      const parsed = JSON.parse(input);
      console.log(`  🔧 ${toolName} → ${JSON.stringify(parsed).slice(0, 120)}`);
    } catch {
      console.log(`  🔧 ${toolName} → ${input.slice(0, 120)}`);
    }
  }

  override handleToolEnd(output: any) {
    const content = output?.kwargs?.content ?? output?.content ?? output;
    const str = typeof content === 'string' ? content : JSON.stringify(content);
    try {
      const parsed = typeof content === 'string' ? JSON.parse(content) : content;
      const count = parsed?.data?.length;
      if (count !== undefined) {
        console.log(`  ✅ → status:${parsed.status} data:${count} results`);
      } else if (parsed?.status === 'ERROR') {
        console.log(`  ❌ → ${parsed?.error?.message}`);
      } else {
        console.log(`  ✅ → ${str.slice(0, 100)}`);
      }
    } catch {
      console.log(`  ✅ → ${str.slice(0, 100)}`);
    }
  }
}

async function main() {
  console.log(`🚀 Job-matcher CLI — running as user ${telegramUserId}`);
  console.log(`📄 CV URL: ${env.CV_URL ?? '(from DB)'}`);

  const sentJobIds = getSentJobIds(userId);
  console.log(`🧠 Already sent to this user: ${sentJobIds.length} jobs`);

  const graph = await buildGraph({ telegramUserId: userId });

  const result = await graph.invoke(
    {
      telegramUserId: userId,
      openrouterKey: env.OPENROUTER_API_KEY,
      rapidApiKey: env.RAPIDAPI_KEY,
      messages: [],
    },
    {
      configurable: { thread_id: `cli-${userId}-${Date.now()}` },
      callbacks: [new ToolCallLogger()],
      recursionLimit: 50,
    }
  );

  const matches = result.matches ?? [];
  console.log(`\n✅ Found ${matches.length} matches:`);
  for (const match of matches) {
    console.log(
      `  [${match.conformancePercentage}%] ${match.posting.title} at ${match.posting.company}`
    );
    if (match.agentNotes) console.log(`       → ${match.agentNotes}`);
  }

  if (matches.length > 0) {
    saveJobs(
      userId,
      matches.map((m: any) => m.posting)
    );
    console.log(`\n💾 Saved ${matches.length} jobs to DB for user ${telegramUserId}.`);
  }
}

main().catch(console.error);
