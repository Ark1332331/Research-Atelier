import {importStudyFiles, STUDY_IMPORT_LIMITS, StudyLibraryError, studyErrorResponse} from '@/lib/study-library';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const maxBody = STUDY_IMPORT_LIMITS.batchBytes + 4 * 1024 * 1024;
    if (Number(request.headers.get('content-length')) > maxBody) throw new StudyLibraryError('单次导入不能超过 128 MiB');
    if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) throw new StudyLibraryError('请使用文件上传表单');
    // Count actual streamed bytes before formData buffers an untrusted multipart request.
    const reader = request.body?.getReader();
    if (!reader) throw new StudyLibraryError('没有收到上传文件');
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maxBody) {await reader.cancel(); throw new StudyLibraryError('单次导入不能超过 128 MiB');}
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks, length);
    let form: FormData;
    try { form = await new Response(bytes, {headers: {'Content-Type': request.headers.get('content-type')!}}).formData(); }
    catch { throw new StudyLibraryError('上传表单格式无效'); }
    const files = form.getAll('files');
    const pathsValue = form.get('paths');
    if (typeof pathsValue !== 'string') throw new StudyLibraryError('缺少导入文件路径');
    const paths: unknown = JSON.parse(pathsValue);
    if (!Array.isArray(paths) || paths.length !== files.length || files.some(file => !(file instanceof File))) throw new StudyLibraryError('导入文件与路径不匹配');
    const integrityValue = form.get('integrity');
    const integrity = integrityValue === null ? undefined : typeof integrityValue === 'string' ? JSON.parse(integrityValue) : null;
    if (integrity !== undefined && (!Array.isArray(integrity) || integrity.length !== files.length || integrity.some(item => !item || typeof item !== 'object'))) throw new StudyLibraryError('导入完整性校验信息无效');
    return Response.json(await importStudyFiles(form.get('parentId'), files.map((file, index) => ({file: file as File, path: paths[index], integrity: integrity?.[index]}))));
  } catch (error) { return studyErrorResponse(error); }
}
