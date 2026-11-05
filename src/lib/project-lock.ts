import {AsyncLocalStorage} from 'node:async_hooks';
const shared=globalThis as typeof globalThis & {researchProjectLock?:{tail:Promise<unknown>;context:AsyncLocalStorage<boolean>}};
const lock=shared.researchProjectLock??={tail:Promise.resolve(),context:new AsyncLocalStorage<boolean>()};
/** All project edits and paper removal share one queue, including nested lifecycle operations. */
export function withProjectLock<T>(work:()=>Promise<T>):Promise<T>{
  if(lock.context.getStore())return work();
  const result=lock.tail.catch(()=>{}).then(()=>lock.context.run(true,work));lock.tail=result.catch(()=>{});return result;
}
