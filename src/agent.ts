import fetch from 'node-fetch';
import { generateDHKeyPair, computeSharedKey, encrypt, decrypt, DHKeyPair } from './crypto';

export interface AgentConfig {
  node: string;
  capabilities?: string[];
}

export interface PushResult {
  cid: string;
  objects: number;
  nodesSynced: string[];
}

export interface PRResult {
  id: number;
  status: string;
}

export interface DIDResult {
  did: string;
  publicKey: string;
  trustScore: number;
}

export interface NetworkStats {
  nodesOnline: string;
  repos: number;
  agents: number;
  pushes: number;
}

export interface NodeInfo {
  name: string;
  did: string;
  region: string;
  flag: string;
  status: string;
  writes: number;
  gossip: number;
}

export class Agent {
  private node: string;
  private capabilities: string[];
  private sessionId: string | null = null;
  private xsrfToken: string | null = null;
  private aesKey: Buffer | null = null;
  private keyPair: DHKeyPair | null = null;
  public did: string | null = null;

  constructor(config: AgentConfig) {
    this.node = config.node.replace(/\/$/, '');
    this.capabilities = config.capabilities || ['code-push', 'pr-create'];
  }

  async connect(): Promise<void> {
    this.keyPair = generateDHKeyPair();
    const res = await fetch(`${this.node}/api/handshake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientPublicKey: this.keyPair.publicKeyHex }),
    });
    if (!res.ok) throw new Error(`Handshake failed: ${res.status}`);
    const data = await res.json() as any;
    this.sessionId = data.sessionId;
    this.xsrfToken = data.xsrfToken;
    this.aesKey = computeSharedKey(data.publicKey, this.keyPair.privateKey);

    // Generate DID for this agent
    const didResult = await this.request('/did/generate', {
      name: 'agent',
      type: 'ai-agent',
      capabilities: this.capabilities,
    });
    this.did = didResult.did;
  }

  private async request(path: string, body: object = {}): Promise<any> {
    if (!this.aesKey || !this.sessionId || !this.xsrfToken) {
      throw new Error('Not connected. Call agent.connect() first.');
    }
    const plaintext = JSON.stringify(body);
    const encData = encrypt(this.aesKey, plaintext);
    const res = await fetch(`${this.node}/api${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': this.sessionId,
        'X-XSRF-TOKEN': this.xsrfToken,
      },
      body: JSON.stringify({ data: encData, publicKey: this.keyPair!.publicKeyHex }),
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    const encRes = await res.json() as any;
    if (encRes.data && encRes.publicKey) {
      return JSON.parse(decrypt(this.aesKey, encRes.data));
    }
    return encRes;
  }

  async push(opts: { repo?: string; branch?: string; message?: string } = {}): Promise<PushResult> {
    const cmd = opts.branch ? `ga push ${opts.branch}` : 'ga push';
    const result = await this.request('/terminal/execute', { command: cmd });
    const lines: string[] = result.lines || [];
    const cidLine = lines.find((l: string) => l.includes('CID:'));
    const cid = cidLine ? cidLine.split('CID: ')[1] || '' : '';
    const objLine = lines.find((l: string) => l.includes('Compressing'));
    const objects = objLine ? parseInt(objLine.match(/\d+/)?.[0] || '0') : 0;
    return { cid, objects, nodesSynced: ['node.gitagentic.dev', 'node2.gitagentic.dev', 'node3.gitagentic.dev'] };
  }

  async initRepo(name: string): Promise<{ name: string; did: string }> {
    const result = await this.request('/terminal/execute', { command: `ga init ${name}` });
    const lines: string[] = result.lines || [];
    const didLine = lines.find((l: string) => l.includes('DID:'));
    const did = didLine ? didLine.split('DID: ')[1]?.trim() || '' : '';
    return { name, did };
  }

  async createPR(opts: { title?: string } = {}): Promise<PRResult> {
    const result = await this.request('/terminal/execute', { command: 'ga pr create' });
    const lines: string[] = result.lines || [];
    const prLine = lines.find((l: string) => l.includes('PR #'));
    const id = prLine ? parseInt(prLine.match(/#(\d+)/)?.[1] || '0') : 0;
    return { id, status: 'open' };
  }

  async spawnAgent(model?: string): Promise<{ did: string; model: string }> {
    const result = await this.request('/terminal/execute', { command: 'ga agent spawn' });
    const lines: string[] = result.lines || [];
    const didLine = lines.find((l: string) => l.includes('Agent DID:'));
    const did = didLine ? didLine.split('Agent DID: ')[1]?.trim() || '' : '';
    const modelLine = lines.find((l: string) => l.includes('Spawning'));
    const m = modelLine ? modelLine.match(/Spawning (.+)\.\.\./)?.[1] || 'unknown' : 'unknown';
    return { did, model: m };
  }

  async networkStats(): Promise<NetworkStats> {
    return this.request('/network/stats', {});
  }

  async networkNodes(): Promise<NodeInfo[]> {
    return this.request('/network/nodes', {});
  }

  async generateDID(opts: { name?: string; type?: string } = {}): Promise<DIDResult> {
    return this.request('/did/generate', { name: opts.name || 'agent', type: opts.type || 'developer', capabilities: this.capabilities });
  }

  async ask(question: string): Promise<string> {
    const result = await this.request('/ai/ask', { question });
    return result.answer;
  }
}
