import path from 'node:path';

/** Runtime data belongs outside build caches. Tests may explicitly opt into an
 * isolated cache, but a normal app must never silently open that disposable store. */
export function resolveDataDirectory(env: Record<string,string | undefined>, cwd: string, persistentDirectory: string): string {
  const override=env.RA_DATA_DIR?.trim();
  const directory=override?path.resolve(cwd,override):env.VERCEL?path.join(cwd,'data'):persistentDirectory;
  const relative=path.relative(cwd,directory);
  const first=relative.split(path.sep)[0].toLowerCase();
  if(['.build-cache','.next','out','build'].includes(first)&&env.RA_ALLOW_TEST_DATA_DIR!=='1') {
    throw new Error(`拒绝把用户数据写入构建或测试缓存目录：${directory}。请使用固定用户数据目录；隔离测试需显式设置 RA_ALLOW_TEST_DATA_DIR=1。`);
  }
  return directory;
}
