import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const pluginDist = new URL('./dist/index.js', import.meta.url).pathname;
let sid = 0;
function freshSid() { return 'test-session-' + (++sid); }
function mockCtx(sessionID) {
  return { sessionID, messageID: 'msg-1', agent: 'test', directory: '/tmp/test-project', worktree: '/tmp/test-project', abort: new AbortController().signal, metadata: () => {}, ask: async () => {} };
}

const projectDir = '/tmp/test-project';
try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
mkdirSync(projectDir, { recursive: true });
mkdirSync(join(projectDir, 'src'), { recursive: true });
writeFileSync(join(projectDir, 'src/index.ts'), 'export function main() { return true; }');

const mockInput = {
  client: {},
  project: { name: 'test', path: projectDir },
  directory: projectDir, worktree: projectDir,
  experimental_workspace: { register: () => {} },
  serverUrl: new URL('http://localhost:3000'),
  $: new Proxy({}, {
    get() { return async () => ({ exitCode: 0, text: () => '', stdout: Buffer.from(''), stderr: Buffer.from('') }); },
  }),
};

const mod = await import(pluginDist);
const hooks = await mod.AgenticEngine(mockInput);
console.log('INIT OK');

const skCtx = mockCtx(freshSid());
console.log('1. plan...');
const planR = await hooks.tool.agentic_plan.execute({ goal: 'Skill test', subtasks: [{ id: 'sk1', description: 'Add user login with email validation', dependsOn: [] }] }, skCtx);
console.log('planR:', typeof planR === 'string' ? planR.substring(0, 80) : planR.output?.substring(0, 80));
console.log('2. execute...');
const execR = await hooks.tool.agentic_execute.execute({ stepId: 'sk1', success: true, output: '1. Created login form\n2. Added email validation\n3. Wrote tests' }, skCtx);
console.log('execR:', typeof execR === 'string' ? execR.substring(0, 80) : execR.output?.substring(0, 80));
console.log('3. extract...');
const r = await hooks.tool.agentic_skill.execute({ action: 'extract', query: 'sk1' }, skCtx);
console.log('4. DONE');
console.log('result:', typeof r === 'string' ? r.substring(0,200) : JSON.stringify(r).substring(0,200));
