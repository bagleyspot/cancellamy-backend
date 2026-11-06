import '../load-env'; // must stay first: some modules read the environment at import time
/**
 * `npm run import:replies -- <file.json> [--apply]`: records how brokers answered, request by request.
 *
 * The file is a JSON list of `{ ref, outcome, at, from?, note?, manual?: { url?, steps?, email? } }`, where `ref` is the
 * request reference (CNC-XXXXXXXX). Without `--apply` nothing is written: it prints what would change. Run it with
 * SCHEDULER_ENABLED=false QUEUE_ENABLED=false so the application context does not start workers.
 */
import { readFileSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../app.module';
import { RemovalRequest, RequestDoc } from '../db/schemas';
import { REPLY_OUTCOMES, ReplyOutcome, planReply } from './reply-outcome';
import { RequestEngine } from './request-engine';

interface ReplyInput {
  ref: string;
  outcome: ReplyOutcome;
  at: string;
  from?: string;
  note?: string;
  manual?: { url?: string; steps?: string[]; email?: string };
}

export function parseReplyFile(source: string): ReplyInput[] {
  const raw = JSON.parse(source) as unknown;
  if (!Array.isArray(raw)) throw new Error('The file must be a JSON list');
  return raw.map((item: Partial<ReplyInput>, i) => {
    if (!item.ref || !/^CNC-[A-Z0-9]{8}$/.test(item.ref)) throw new Error(`[${i}] ref must look like CNC-XXXXXXXX`);
    if (!item.outcome || !(REPLY_OUTCOMES as readonly string[]).includes(item.outcome)) throw new Error(`[${i}] ${item.ref}: outcome must be one of ${REPLY_OUTCOMES.join(', ')}`);
    if (!item.at || Number.isNaN(Date.parse(item.at))) throw new Error(`[${i}] ${item.ref}: at must be an ISO date`);
    return item as ReplyInput;
  });
}

const out = (line: string): void => void process.stdout.write(`${line}\n`);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const apply = args.includes('--apply');
  if (!file) throw new Error('Usage: import-replies <file.json> [--apply]');
  const replies = parseReplyFile(readFileSync(file, 'utf8'));

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const requests = app.get<Model<RequestDoc>>(getModelToken(RemovalRequest.name));
    const engine = app.get(RequestEngine);
    let changed = 0;
    for (const reply of replies) {
      const req = await requests.findOne({ shortRef: reply.ref });
      if (!req) {
        out(`${reply.ref}  NOT FOUND`);
        continue;
      }
      const plan = planReply(req.status, reply.outcome);
      const move = plan.to ? `${req.status} -> ${plan.to}` : `${req.status} (kept)`;
      out(`${reply.ref}  ${req.brokerKey.padEnd(16)} ${reply.outcome.padEnd(25)} ${move}${req.reply ? '  [already has a reply: replaced]' : ''}`);
      if (!apply) continue;
      await engine.recordReply(req, { outcome: reply.outcome, at: new Date(reply.at), from: reply.from, note: reply.note, manual: reply.manual });
      changed += 1;
    }
    out(apply ? `Recorded ${changed} of ${replies.length} replies.` : `Dry run: nothing written (${replies.length} replies). Add --apply to record them.`);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
