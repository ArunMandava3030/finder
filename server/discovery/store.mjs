import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

export function createDiscoveryStore(filePath) {
  let writing = Promise.resolve();
  async function read() {
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8'));
      if (parsed.schemaVersion !== 1 || !parsed.destinations || typeof parsed.destinations !== 'object') throw new Error('Unsupported discovery store');
      return parsed;
    } catch (error) {
      if (error.code === 'ENOENT') return { schemaVersion: 1, destinations: {} };
      throw error;
    }
  }
  async function get(id) { return (await read()).destinations[id] || null; }
  async function put(id, value) {
    const task = writing.catch(() => {}).then(async () => {
      const data = await read();
      data.destinations[id] = value;
      await mkdir(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.tmp`;
      await writeFile(temp, JSON.stringify(data), 'utf8');
      await rename(temp, filePath);
    });
    writing = task;
    await task;
  }
  return { get, put, read };
}
