#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const https = require('https');
const minimist = require('minimist');
const FormData = require('form-data');
const archiver = require('archiver');

const EXOPORT_HOSTNAME = `https://exoport.webmr.io`;
const EXOPORT_UPLOAD_URL = `${EXOPORT_HOSTNAME}/upload`;

const args = minimist(process.argv.slice(2), {
  string: [
    'packageType',
    'appName',
    'packageName',
    'buildType',
    'contentUrl',
    'contentDir',
    'output',
    'model',
    'portal',
    'cert',
    'privkey',
  ],
  alias: {
    t: 'packageType',
    a: 'appName',
    p: 'packageName',
    b: 'buildType',
    f: 'contentDir',
    u: 'contentUrl',
    o: 'output',
    m: 'model',
    r: 'portal',
    c: 'cert',
    k: 'privkey',
  },
});

let {
  packageType,
  appName,
  packageName,
  buildType,
  model: modelPath,
  portal: portalPath,
  contentUrl: contentUrlPath,
  contentDir: contentDirPath,
  output: outputPath,
  cert: certPath,
  privkey: privkeyPath,
} = args;
if (!packageType) {
  packageType = 'mpk';
}
if (!buildType) {
  buildType = 'debug';
}

const _readFile = p => new Promise((accept, reject) => {
  fs.readFile(p, (err, data) => {
    if (!err) {
      accept(data);
    } else {
      reject(err);
    }
  });
});
const _readDirectory = p => new Promise((accept, reject) => {
  fs.lstat(p, (err, stats) => {
    if (!err && stats.isDirectory()) {
      const archive = archiver('zip', {
        zlib: {
          level: 9,
        },
      });
      const bs = [];
      archive.on('data', d => {
        bs.push(d);
      });
      archive.on('end', () => {
        const b = Buffer.concat(bs);
        fs.writeFileSync('/tmp/lol.zip', b);
        accept(b);
      });
      archive.on('error', reject);

      archive.directory(p, '/');
      archive.finalize();
    } else {
      reject(new Error(`${p} is not a directory`));
    }
  });
});

let valid = true;
if (!['windows', 'macos', 'linux', 'android', 'mpk'].includes(packageType)) {
  console.warn('invalid packageType');
  valid = false;
}
if (packageType === 'mpk' && !appName) {
  console.warn('missing appName');
  valid = false;
}
if (packageType === 'mpk' && !packageName) {
  console.warn('missing packageName');
  valid = false;
}
if (!['production', 'debug'].includes(buildType)) {
  console.warn('invalid buildType');
  valid = false;
}
if (!contentUrlPath && !contentDirPath) {
  console.warn('invalid contentUrlPath or contentDirPath');
  valid = false;
} else if (contentUrlPath && contentDirPath) {
  console.warn('cannot use both contentUrlPath and contentDirPath');
  valid = false;
}
if (!outputPath) {
  console.warn('invalid outputPath');
  valid = false;
}
if (packageType === 'mpk' && !certPath) {
  console.warn('invalid certPath');
  valid = false;
}
if (packageType === 'mpk' && !privkeyPath) {
  console.warn('invalid privkeyPath');
  valid = false;
}
if (valid) {
  (async () => {
    // build form request
    const form = new FormData();

    form.append('appname', appName);
    form.append('packagename', packageName);
    form.append('buildtype', buildType);

    if (contentUrlPath) {
      form.append('app.url', contentDirBuffer, contentUrlPath);
    } else if (contentDirPath) {
      const contentDirBuffer = await _readDirectory(contentDirPath);
      form.append('app.zip', contentDirBuffer, {
        filename: 'app.zip',
      });
    }

    if (packageType === 'mpk') {
      if (modelPath) {
        const modelBuffer = await _readFile(modelPath);
        form.append('model.zip', modelBuffer, {
          filename: 'model.zip',
        });
      }
      if (portalPath) {
        const portalBuffer = await _readFile(portalPath);
        form.append('portal.zip', portalBuffer, {
          filename: 'portal.zip',
        });
      }

      const certBuffer = await _readFile(certPath);
      form.append('app.cert', certBuffer);

      const privkeyBuffer = await _readFile(privkeyPath);
      form.append('app.privkey', privkeyBuffer);
    }

    // submit
    const u = await new Promise((accept, reject) => {
      form.submit(EXOPORT_UPLOAD_URL, (err, res) => {
        if (!err) {
          const bs = [];
          res.on('data', d => {
            bs.push(d);
          });
          res.on('end', () => {
            const b = Buffer.concat(bs);
            const s = b.toString('utf8');
            const j = JSON.parse(s);
            const {url} = j;
            accept(url);
          });
          res.on('error', reject);
        } else {
          reject(err);
        }
      });
    });

    // download
    await new Promise((accept, reject) => {
      const req = (/^https:/.test(EXOPORT_HOSTNAME) ? https : http).get(`${EXOPORT_HOSTNAME}${u}`, res => {
        const ws = fs.createWriteStream(outputPath);
        res.pipe(ws);
        ws.on('finish', () => {
          accept();
        });
        ws.on('error', reject);
      });
      req.on('error', reject);
      req.end();
    });
  })()
    .catch(err => {
      console.warn(err.stack);
    });
} else {
  console.warn('usage: exoport <-t packageType> <-a appName> <-p packageName> <-b buildType> <-u contentUrl|-f contentDir> [-o output] <-m model> <-r portal> [-c cert] [-k privkey]');
}
