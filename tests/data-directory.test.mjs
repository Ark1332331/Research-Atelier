import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {resolveDataDirectory} from '../src/lib/data-directory.ts';
test('normal starts use the same persistent directory; cache storage requires explicit test opt-in',()=>{
 const cwd=path.resolve('example-project'),fixed=path.resolve('persistent-data');
 assert.equal(resolveDataDirectory({},cwd,fixed),fixed);
 assert.equal(resolveDataDirectory({RA_DATA_DIR:'  '},cwd,fixed),fixed);
 assert.throws(()=>resolveDataDirectory({RA_DATA_DIR:path.join(cwd,'.build-cache','study-test-data')},cwd,fixed),/RA_ALLOW_TEST_DATA_DIR/);
 assert.equal(resolveDataDirectory({RA_DATA_DIR:path.join(cwd,'.build-cache','isolated'),RA_ALLOW_TEST_DATA_DIR:'1'},cwd,fixed),path.join(cwd,'.build-cache','isolated'));
 assert.equal(resolveDataDirectory({RA_DATA_DIR:fixed},cwd,fixed),fixed);
});
