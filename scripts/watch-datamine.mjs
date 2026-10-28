#!/usr/bin/env node
// Run with GH_TOKEN and GH_REPO set; the watcher itself never changes site data.
import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

const repo = process.env.GH_REPO;
if (!repo) throw new Error('GH_REPO must identify the app repository');
const minutes = Number(process.env.WATCH_MINUTES || 120);
const interval = Number(process.env.WATCH_INTERVAL_SECONDS || 60);
if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 120) throw new Error('WATCH_MINUTES must be in (0, 120]');
if (!Number.isFinite(interval) || interval < 30) throw new Error('WATCH_INTERVAL_SECONDS must be at least 30');
const deadline = Date.now() + minutes * 60_000;
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', timeout: 60_000 }).trim();
let failures = 0;
console.log(`Watching until ${new Date(deadline).toISOString()}`);
while (Date.now() < deadline) {
  try {
    const latest = gh('api', 'repos/absolutelypm/pokemas-datamine/commits/main', '--jq', '.sha');
    const content = gh('api', `repos/${repo}/contents/config/datamine-sha.txt?ref=main`, '--jq', '.content');
    const published = Buffer.from(content, 'base64').toString('utf8').trim();
    if (latest !== published) {
      const runs = JSON.parse(gh('run', 'list', '--repo', repo, '--workflow', 'update-datamine.yml', '--limit', '30', '--json', 'status'));
      if (runs.some(r => r.status !== 'completed')) {
        console.log('Update already running; latest source will be checked again next minute.');
      } else {
        gh('workflow', 'run', 'update-datamine.yml', '--repo', repo, '--ref', 'main');
        console.log(`Requested guarded build and deploy for ${latest}`);
      }
    } else console.log(`Up to date: ${latest}`);
    failures = 0;
  } catch (error) {
    console.error(`Check failed (${++failures}): ${error.message}`);
    if (failures >= 5) throw error;
  }
  await setTimeout(Math.max(0, Math.min(interval * 1000, deadline - Date.now())));
}
console.log('Two-hour watch window finished. Any dispatched update continues to completion.');
