const fs = require('fs');

function check(file, ids) {
  const html = fs.readFileSync(file, 'utf8');
  const missing = ids.filter((id) => !new RegExp(`id=\\"${id}\\"`).test(html));
  if (missing.length) {
    console.log(`${file}: MISSING -> ${missing.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`${file}: OK`);
  }
}

check('bg-remover-demo.html', [
  'btnActivateApi',
  'demoStatusIndicator',
  'demoStatusText',
  'tab-single',
  'tab-bulk',
  'tab-jobs',
  'panel-single',
  'panel-bulk',
  'panel-jobs',
  'singleUpload',
  'singleFile',
  'btnSingleProcess',
  'btnSingleClear',
  'bulkUpload',
  'bulkFiles',
  'btnBulkProcess',
  'btnBulkClear',
  'jobId',
  'btnJobCheck',
]);

check('signature-demo.html', [
  'btnSigActivate',
  'sigStatusIndicator',
  'sigStatusText',
  'sigFileInput',
  'btnSigLoad',
  'sigFileList',
  'sigChkBatch',
  'btnSigBatch',
  'btnSigProcess',
  'btnSigDownload',
  'sigImgBefore',
  'sigImgAfter',
  'sigPreset',
  'sigFormat',
  'sigMargin',
  'sigOccupancy',
  'sigThickness',
  'sigForceBlack',
  'sigLog',
]);
